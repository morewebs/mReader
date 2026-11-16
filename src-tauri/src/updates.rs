use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use reqwest::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use url::Url;

use crate::delta_codec::{
    apply_patch_to_writer, sha256_hex_reader, unpack_reader_to_writer, MAX_ARTIFACT_BYTES,
};

const MAX_MANIFEST_BYTES: usize = 512 * 1024;
const ALLOWED_DOWNLOAD_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "codeload.github.com",
];

static UPDATING: AtomicBool = AtomicBool::new(false);

fn configured_pubkey() -> Option<[u8; 32]> {
    let raw = option_env!("MREADER_UPDATE_PUBKEY")?.trim();
    if raw.is_empty() {
        return None;
    }
    let bytes = STANDARD.decode(raw).ok()?;
    bytes.try_into().ok()
}

fn configured_repo() -> &'static str {
    match option_env!("MREADER_UPDATE_REPO") {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => "morewebs/mReader",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedEnvelope {
    pub payload: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub schema: u32,
    pub version: String,
    pub published_at: String,
    pub release_url: String,
    pub notes: Option<String>,
    pub targets: BTreeMap<String, TargetUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetUpdate {
    pub target_sha256: String,
    pub target_size: u64,
    pub packed_url: String,
    pub packed_size: u64,
    pub installer_url: Option<String>,
    pub patches: Vec<DeltaPatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaPatch {
    pub from_version: String,
    pub from_sha256: String,
    pub patch_url: String,
    pub patch_sha256: String,
    pub patch_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub enabled: bool,
    pub current_version: String,
    pub available: Option<AvailableUpdate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub notes: Option<String>,
    pub release_url: String,
    pub strategy: String,
    pub download_bytes: u64,
    pub full_bytes: u64,
    pub can_install_in_place: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone)]
struct LocalInstall {
    target_keys: Vec<&'static str>,
    artifact_path: PathBuf,
    in_place_dir: Option<PathBuf>,
    can_install_in_place: bool,
}

pub fn cleanup_pending_old_binary() {
    #[cfg(target_os = "windows")]
    if let Ok(exe) = std::env::current_exe() {
        let old = exe.with_extension("exe.old");
        if old.exists() {
            let _ = fs::remove_file(&old);
        }
    }
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let Some(pubkey) = configured_pubkey() else {
        return Ok(UpdateCheckResult {
            enabled: false,
            current_version,
            available: None,
        });
    };

    let repo = configured_repo();
    let manifest_url =
        format!("https://github.com/{repo}/releases/latest/download/mreader-update.json");
    let client = build_update_client()?;
    let bytes = download_bounded(
        &client,
        &manifest_url,
        repo,
        MAX_MANIFEST_BYTES as u64,
        |_| {},
    )
    .await?;
    let manifest = verify_and_parse_manifest(&bytes, &pubkey, repo)?;

    let Ok(curr_ver) = Version::parse(&current_version) else {
        return Err("Invalid current app version".into());
    };
    let Ok(next_ver) = Version::parse(&manifest.version) else {
        return Err("Invalid manifest version".into());
    };
    if next_ver <= curr_ver {
        return Ok(UpdateCheckResult {
            enabled: true,
            current_version,
            available: None,
        });
    }

    let local = detect_local_install(&app)?;
    let (_, target) = select_target(&manifest, &local)?;
    let full_bytes = target.target_size;
    let packed_size = target.packed_size;
    let base_sha = hash_file_sha256(&local.artifact_path).ok();
    let matching_patch = base_sha.as_deref().and_then(|sha| {
        target
            .patches
            .iter()
            .find(|p| p.from_sha256.eq_ignore_ascii_case(sha))
    });

    let (strategy, download_bytes) = if !local.can_install_in_place {
        ("external".to_string(), packed_size)
    } else if let Some(patch) = matching_patch {
        ("delta".to_string(), patch.patch_size)
    } else {
        ("packed".to_string(), packed_size)
    };

    Ok(UpdateCheckResult {
        enabled: true,
        current_version,
        available: Some(AvailableUpdate {
            version: manifest.version,
            notes: manifest.notes,
            release_url: manifest.release_url,
            strategy,
            download_bytes,
            full_bytes,
            can_install_in_place: local.can_install_in_place,
        }),
    })
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if UPDATING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("An update is already in progress".into());
    }
    let _guard = UpdateGuard;

    let Some(pubkey) = configured_pubkey() else {
        return Err("Updates are not enabled in this build".into());
    };
    let repo = configured_repo();
    let manifest_url =
        format!("https://github.com/{repo}/releases/latest/download/mreader-update.json");
    let client = build_update_client()?;
    let manifest_bytes = download_bounded(
        &client,
        &manifest_url,
        repo,
        MAX_MANIFEST_BYTES as u64,
        |_| {},
    )
    .await?;
    let manifest = verify_and_parse_manifest(&manifest_bytes, &pubkey, repo)?;

    let current_ver = Version::parse(&app.package_info().version.to_string())
        .map_err(|_| "Invalid current version".to_string())?;
    let next_ver =
        Version::parse(&manifest.version).map_err(|_| "Invalid manifest version".to_string())?;
    if next_ver <= current_ver {
        return Err("Already up to date".into());
    }

    let local = detect_local_install(&app)?;
    if !local.can_install_in_place {
        return Err("In-place updates require a user-writable install directory; download from the release page.".into());
    }

    let (_, target) = select_target(&manifest, &local)?;
    let base_sha = hash_file_sha256(&local.artifact_path).ok();
    let matching_patch = base_sha.as_deref().and_then(|sha| {
        target
            .patches
            .iter()
            .find(|p| p.from_sha256.eq_ignore_ascii_case(sha))
    });

    let staging_dir = local
        .in_place_dir
        .clone()
        .ok_or_else(|| "No writable staging directory".to_string())?;
    fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    let staged_path = staging_dir.join(if cfg!(target_os = "android") {
        "mReader-update.apk"
    } else {
        ".mreader-update.tmp"
    });
    let _ = fs::remove_file(&staged_path);

    let mut applied_delta = false;
    if let Some(patch) = matching_patch {
        if try_apply_delta(
            &app,
            &client,
            repo,
            &local.artifact_path,
            patch,
            &staged_path,
            target,
        )
        .await
        .is_ok()
        {
            applied_delta = true;
        } else {
            let _ = fs::remove_file(&staged_path);
        }
    }

    if !applied_delta {
        apply_packed(&app, &client, repo, target, &staged_path).await?;
    }

    emit_progress(&app, "installing", target.target_size, target.target_size);
    finalize_install(&app, &local, &staged_path)
}

async fn try_apply_delta(
    app: &AppHandle,
    client: &Client,
    repo: &str,
    base_path: &Path,
    patch: &DeltaPatch,
    staged_path: &Path,
    target: &TargetUpdate,
) -> Result<(), String> {
    let patch_bytes = download_bounded(
        client,
        &patch.patch_url,
        repo,
        patch.patch_size + 4096,
        |dl| {
            emit_progress(app, "downloading", dl, patch.patch_size);
        },
    )
    .await?;

    if patch_bytes.len() as u64 != patch.patch_size {
        return Err("Downloaded patch size mismatch".into());
    }
    let patch_sha = sha256_hex_slice(&patch_bytes);
    if !patch_sha.eq_ignore_ascii_case(&patch.patch_sha256) {
        return Err("Downloaded patch SHA-256 mismatch".into());
    }

    emit_progress(app, "patching", patch.patch_size, patch.patch_size);
    let base_bytes = fs::read(base_path).map_err(|e| e.to_string())?;
    let out_file = File::create(staged_path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(out_file);
    apply_patch_to_writer(&base_bytes, std::io::Cursor::new(&patch_bytes), &mut writer)
        .map_err(|e| format!("Patch reconstruction failed: {e}"))?;
    writer.flush().map_err(|e| e.to_string())?;
    drop(base_bytes);

    emit_progress(app, "verifying", target.target_size, target.target_size);
    verify_staged_file(staged_path, target)
}

async fn apply_packed(
    app: &AppHandle,
    client: &Client,
    repo: &str,
    target: &TargetUpdate,
    staged_path: &Path,
) -> Result<(), String> {
    let packed_bytes = download_bounded(
        client,
        &target.packed_url,
        repo,
        target.packed_size + 4096,
        |dl| {
            emit_progress(app, "downloading", dl, target.packed_size);
        },
    )
    .await?;

    emit_progress(app, "verifying", target.packed_size, target.packed_size);
    let out_file = File::create(staged_path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(out_file);
    unpack_reader_to_writer(std::io::Cursor::new(&packed_bytes), &mut writer)
        .map_err(|e| format!("Failed to unpack update: {e}"))?;
    writer.flush().map_err(|e| e.to_string())?;

    verify_staged_file(staged_path, target)
}

fn verify_staged_file(path: &Path, target: &TargetUpdate) -> Result<(), String> {
    let (size, sha) = hash_file_with_size(path).map_err(|e| e.to_string())?;
    if size != target.target_size || !sha.eq_ignore_ascii_case(&target.target_sha256) {
        let _ = fs::remove_file(path);
        return Err("Reconstructed update failed integrity verification".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn finalize_install(
    app: &AppHandle,
    local: &LocalInstall,
    staged_path: &Path,
) -> Result<(), String> {
    let current_exe = &local.artifact_path;
    let old_exe = current_exe.with_extension("exe.old");
    let _ = fs::remove_file(&old_exe);

    fs::rename(current_exe, &old_exe)
        .map_err(|e| format!("Failed to stage active executable for replacement: {e}"))?;

    if let Err(err) = fs::rename(staged_path, current_exe) {
        let _ = fs::rename(&old_exe, current_exe);
        return Err(format!("Failed to install updated executable: {err}"));
    }

    std::process::Command::new(current_exe)
        .spawn()
        .map_err(|e| format!("Updated binary installed, but failed to relaunch: {e}"))?;

    app.exit(0);
    Ok(())
}

#[cfg(target_os = "linux")]
fn finalize_install(
    app: &AppHandle,
    local: &LocalInstall,
    staged_path: &Path,
) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut perms = fs::metadata(staged_path)
        .map_err(|e| e.to_string())?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(staged_path, perms).map_err(|e| e.to_string())?;

    fs::rename(staged_path, &local.artifact_path)
        .map_err(|e| format!("Failed to replace executable: {e}"))?;

    std::process::Command::new(&local.artifact_path)
        .spawn()
        .map_err(|e| format!("Updated binary installed, but failed to relaunch: {e}"))?;

    app.exit(0);
    Ok(())
}

#[cfg(target_os = "android")]
fn finalize_install(
    _app: &AppHandle,
    _local: &LocalInstall,
    staged_path: &Path,
) -> Result<(), String> {
    android_bridge::install_apk(staged_path)
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "android")))]
fn finalize_install(
    _app: &AppHandle,
    _local: &LocalInstall,
    _staged_path: &Path,
) -> Result<(), String> {
    Err("Self-update is supported on Windows, Linux, and Android".into())
}

fn detect_local_install(app: &AppHandle) -> Result<LocalInstall, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let parent = exe.parent().map(Path::to_path_buf);
        let writable = parent.as_deref().is_some_and(probe_writable);
        let key = if cfg!(target_arch = "aarch64") {
            "windows-aarch64"
        } else {
            "windows-x86_64"
        };
        Ok(LocalInstall {
            target_keys: vec![key],
            artifact_path: exe,
            in_place_dir: parent,
            can_install_in_place: writable,
        })
    }

    #[cfg(target_os = "linux")]
    {
        let _ = app;
        if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|v| !v.is_empty()) {
            let path = PathBuf::from(appimage);
            let parent = path.parent().map(Path::to_path_buf);
            let writable = parent.as_deref().is_some_and(probe_writable);
            return Ok(LocalInstall {
                target_keys: vec!["linux-x86_64-appimage"],
                artifact_path: path,
                in_place_dir: parent,
                can_install_in_place: writable,
            });
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let parent = exe.parent().map(Path::to_path_buf);
        let writable = parent.as_deref().is_some_and(probe_writable);
        Ok(LocalInstall {
            target_keys: vec!["linux-x86_64-bin"],
            artifact_path: exe,
            in_place_dir: parent,
            can_install_in_place: writable,
        })
    }

    #[cfg(target_os = "android")]
    {
        let apk_path = android_bridge::get_apk_path()?;
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("updates");
        let keys = if cfg!(target_arch = "aarch64") {
            vec!["android-arm64", "android-universal"]
        } else {
            vec!["android-universal"]
        };
        Ok(LocalInstall {
            target_keys: keys,
            artifact_path: apk_path,
            in_place_dir: Some(cache_dir),
            can_install_in_place: true,
        })
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "android")))]
    {
        let _ = app;
        Err("Unsupported platform for updates".into())
    }
}

fn select_target<'a>(
    manifest: &'a UpdateManifest,
    local: &LocalInstall,
) -> Result<(&'static str, &'a TargetUpdate), String> {
    let base_sha = hash_file_sha256(&local.artifact_path).ok();
    if let Some(sha) = base_sha.as_deref() {
        for &key in &local.target_keys {
            if let Some(t) = manifest.targets.get(key) {
                if t.patches
                    .iter()
                    .any(|p| p.from_sha256.eq_ignore_ascii_case(sha))
                {
                    return Ok((key, t));
                }
            }
        }
    }
    for &key in &local.target_keys {
        if let Some(t) = manifest.targets.get(key) {
            return Ok((key, t));
        }
    }
    Err("No update package published for this platform".into())
}

#[cfg(not(target_os = "android"))]
fn probe_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".mreader-write-probe-{}", std::process::id()));
    match File::create(&probe) {
        Ok(f) => {
            drop(f);
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

pub fn verify_and_parse_manifest(
    bytes: &[u8],
    pubkey: &[u8; 32],
    expected_repo: &str,
) -> Result<UpdateManifest, String> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Update manifest exceeds size limit".into());
    }
    let envelope: SignedEnvelope =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid update envelope: {e}"))?;
    let payload_bytes = STANDARD
        .decode(envelope.payload.trim())
        .map_err(|_| "Invalid update payload encoding".to_string())?;
    let sig_bytes = STANDARD
        .decode(envelope.signature.trim())
        .map_err(|_| "Invalid update signature encoding".to_string())?;
    let sig =
        Signature::from_slice(&sig_bytes).map_err(|_| "Invalid Ed25519 signature".to_string())?;
    VerifyingKey::from_bytes(pubkey)
        .map_err(|_| "Invalid update public key".to_string())?
        .verify_strict(&payload_bytes, &sig)
        .map_err(|_| "Update manifest signature verification failed".to_string())?;

    let manifest: UpdateManifest = serde_json::from_slice(&payload_bytes)
        .map_err(|e| format!("Invalid manifest payload: {e}"))?;

    if manifest.schema != 1 {
        return Err(format!("Unsupported update schema: {}", manifest.schema));
    }
    chrono::DateTime::parse_from_rfc3339(&manifest.published_at)
        .map_err(|_| "Invalid manifest timestamp".to_string())?;
    validate_release_url(&manifest.release_url, expected_repo)?;

    for target in manifest.targets.values() {
        validate_github_asset_url(&target.packed_url, expected_repo)?;
        if let Some(ref inst) = target.installer_url {
            validate_github_asset_url(inst, expected_repo)?;
        }
        if target.target_size == 0 || target.target_size > MAX_ARTIFACT_BYTES {
            return Err("Invalid target artifact size".into());
        }
        if !is_sha256_hex(&target.target_sha256) {
            return Err("Invalid target SHA-256".into());
        }
        for patch in &target.patches {
            validate_github_asset_url(&patch.patch_url, expected_repo)?;
            if !is_sha256_hex(&patch.from_sha256) || !is_sha256_hex(&patch.patch_sha256) {
                return Err("Invalid patch SHA-256".into());
            }
            if patch.patch_size == 0 || patch.patch_size > MAX_ARTIFACT_BYTES {
                return Err("Invalid patch size".into());
            }
        }
    }

    Ok(manifest)
}

fn validate_release_url(raw: &str, repo: &str) -> Result<(), String> {
    let url = Url::parse(raw).map_err(|_| "Invalid release URL".to_string())?;
    let prefix = format!("/{repo}/releases/");
    if url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with(&prefix)
    {
        Ok(())
    } else {
        Err("Untrusted release URL".into())
    }
}

fn validate_github_asset_url(raw: &str, repo: &str) -> Result<(), String> {
    let url = Url::parse(raw).map_err(|_| "Invalid asset URL".to_string())?;
    let prefix = format!("/{repo}/releases/download/");
    if url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path().starts_with(&prefix)
    {
        Ok(())
    } else {
        Err("Untrusted update asset URL".into())
    }
}

fn validate_redirect_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url
            .host_str()
            .is_some_and(|h| ALLOWED_DOWNLOAD_HOSTS.contains(&h))
}

fn build_update_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("mReader-Updater/0.1")
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !validate_redirect_url(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

async fn download_bounded<F>(
    client: &Client,
    url: &str,
    expected_repo: &str,
    max_bytes: u64,
    mut on_progress: F,
) -> Result<Vec<u8>, String>
where
    F: FnMut(u64),
{
    let parsed = Url::parse(url).map_err(|_| "Invalid download URL".to_string())?;
    let allowed_path = parsed
        .path()
        .starts_with(&format!("/{expected_repo}/releases/"));
    if parsed.scheme() != "https" || parsed.host_str() != Some("github.com") || !allowed_path {
        return Err("Download URL outside repository release origin".into());
    }

    let resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Update request failed: {e}"))?;
    if !validate_redirect_url(resp.url()) {
        return Err("Blocked redirect to untrusted update host".into());
    }
    let mut resp = resp
        .error_for_status()
        .map_err(|e| format!("Update server returned error: {e}"))?;

    let mut out = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Stream read failed: {e}"))?
    {
        if (out.len() as u64) + (chunk.len() as u64) > max_bytes {
            return Err("Update payload exceeded expected size limit".into());
        }
        out.extend_from_slice(&chunk);
        on_progress(out.len() as u64);
    }
    Ok(out)
}

fn hash_file_sha256(path: &Path) -> Result<String, std::io::Error> {
    let (_, hex) = hash_file_with_size(path)?;
    Ok(hex)
}

fn hash_file_with_size(path: &Path) -> Result<(u64, String), std::io::Error> {
    let f = File::open(path)?;
    sha256_hex_reader(f)
}

fn sha256_hex_slice(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn emit_progress(app: &AppHandle, stage: &str, downloaded_bytes: u64, total_bytes: u64) {
    let _ = app.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: stage.to_string(),
            downloaded_bytes,
            total_bytes,
        },
    );
}

struct UpdateGuard;
impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATING.store(false, Ordering::SeqCst);
    }
}

#[cfg(target_os = "android")]
mod android_bridge {
    use std::path::{Path, PathBuf};

    use jni::objects::{JObject, JString, JValue};

    pub fn get_apk_path() -> Result<PathBuf, String> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };

        let app_info = env
            .call_method(
                &context,
                "getApplicationInfo",
                "()Landroid/content/pm/ApplicationInfo;",
                &[],
            )
            .map_err(|e| format!("getApplicationInfo failed: {e}"))?
            .l()
            .map_err(|e| e.to_string())?;

        let source_dir: JString = env
            .get_field(&app_info, "sourceDir", "Ljava/lang/String;")
            .map_err(|e| format!("sourceDir lookup failed: {e}"))?
            .l()
            .map_err(|e| e.to_string())?
            .into();

        let path_str: String = env
            .get_string(&source_dir)
            .map_err(|e| e.to_string())?
            .into();
        Ok(PathBuf::from(path_str))
    }

    pub fn install_apk(apk_path: &Path) -> Result<(), String> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };

        let loader = env
            .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
            .map_err(|e| e.to_string())?
            .l()
            .map_err(|e| e.to_string())?;
        let class_name = env
            .new_string("com.moreweb.mreader.AndroidUpdater")
            .map_err(|e| e.to_string())?;
        let helper_cls_obj = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&class_name)],
            )
            .map_err(|e| format!("loadClass AndroidUpdater failed: {e}"))?
            .l()
            .map_err(|e| e.to_string())?;
        let helper_cls: jni::objects::JClass = helper_cls_obj.into();

        let path_jstr = env
            .new_string(apk_path.to_string_lossy().as_ref())
            .map_err(|e| e.to_string())?;
        let res = env.call_static_method(
            helper_cls,
            "installApk",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(&context), JValue::Object(&path_jstr)],
        );
        res.map_err(|e| format!("Android APK install failed: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};

    use super::*;

    fn test_manifest(repo: &str) -> UpdateManifest {
        let mut targets = BTreeMap::new();
        targets.insert(
            "windows-x86_64".into(),
            TargetUpdate {
                target_sha256: "a".repeat(64),
                target_size: 12_000_000,
                packed_url: format!("https://github.com/{repo}/releases/download/v0.2.0/mReader-win-x64.exe.zst"),
                packed_size: 4_100_000,
                installer_url: Some(format!("https://github.com/{repo}/releases/download/v0.2.0/mReader-Setup-x64.exe")),
                patches: vec![DeltaPatch {
                    from_version: "0.1.0".into(),
                    from_sha256: "b".repeat(64),
                    patch_url: format!("https://github.com/{repo}/releases/download/v0.2.0/mReader-win-x64-from-0.1.0.patch.zst"),
                    patch_sha256: "c".repeat(64),
                    patch_size: 280_000,
                }],
            },
        );
        UpdateManifest {
            schema: 1,
            version: "0.2.0".into(),
            published_at: "2026-11-16T12:00:00Z".into(),
            release_url: format!("https://github.com/{repo}/releases/tag/v0.2.0"),
            notes: Some("Delta updates".into()),
            targets,
        }
    }

    #[test]
    fn verifies_signed_manifest_and_rejects_tampered_payload() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let pubkey = key.verifying_key().to_bytes();

        let manifest = test_manifest("morewebs/mReader");
        let payload = serde_json::to_vec(&manifest).expect("json");
        let sig = key.sign(&payload);

        let envelope = SignedEnvelope {
            payload: STANDARD.encode(&payload),
            signature: STANDARD.encode(sig.to_bytes()),
        };
        let bytes = serde_json::to_vec(&envelope).expect("env");

        let parsed =
            verify_and_parse_manifest(&bytes, &pubkey, "morewebs/mReader").expect("verify");
        assert_eq!(parsed.version, "0.2.0");

        // Tamper one byte in payload
        let mut bad_payload = payload;
        bad_payload[5] ^= 0xFF;
        let bad_env = SignedEnvelope {
            payload: STANDARD.encode(&bad_payload),
            signature: STANDARD.encode(sig.to_bytes()),
        };
        let bad_bytes = serde_json::to_vec(&bad_env).expect("bad env");
        assert!(verify_and_parse_manifest(&bad_bytes, &pubkey, "morewebs/mReader").is_err());
    }

    #[test]
    fn rejects_untrusted_download_origins() {
        let key = SigningKey::from_bytes(&[9u8; 32]);
        let pubkey = key.verifying_key().to_bytes();

        let mut manifest = test_manifest("morewebs/mReader");
        manifest
            .targets
            .get_mut("windows-x86_64")
            .unwrap()
            .packed_url = "https://evil.example.com/payload.zst".into();

        let payload = serde_json::to_vec(&manifest).expect("json");
        let sig = key.sign(&payload);
        let bytes = serde_json::to_vec(&SignedEnvelope {
            payload: STANDARD.encode(&payload),
            signature: STANDARD.encode(sig.to_bytes()),
        })
        .unwrap();

        assert!(verify_and_parse_manifest(&bytes, &pubkey, "morewebs/mReader").is_err());
    }
}
