#[path = "../../../src-tauri/src/delta_codec.rs"]
mod delta_codec;

use std::env;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Cursor, Write};
use std::path::Path;
use std::process;

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;

#[derive(Serialize)]
struct SignedEnvelope {
    payload: String,
    signature: String,
}

#[derive(Serialize)]
struct ArtifactMeta {
    size: u64,
    sha256: String,
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if let Err(err) = run(&args) {
        eprintln!("delta-tool: {err}");
        process::exit(1);
    }
}

fn run(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("keygen") => cmd_keygen(),
        Some("hash") if args.len() == 2 => cmd_hash(&args[1]),
        Some("pack") if args.len() == 3 => cmd_pack(&args[1], &args[2]),
        Some("unpack") if args.len() == 3 => cmd_unpack(&args[1], &args[2]),
        Some("patch") if args.len() == 4 => cmd_patch(&args[1], &args[2], &args[3]),
        Some("sign-manifest") if args.len() == 3 => cmd_sign_manifest(&args[1], &args[2]),
        _ => Err(
            "usage:\n  delta-tool keygen\n  delta-tool hash <file>\n  delta-tool pack <in> <out.zst>\n  delta-tool unpack <in.zst> <out>\n  delta-tool patch <base> <new> <out.patch.zst>\n  delta-tool sign-manifest <manifest.json> <signed.json>"
                .into(),
        ),
    }
}

fn cmd_keygen() -> Result<(), String> {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|e| e.to_string())?;
    let signing = SigningKey::from_bytes(&seed);
    let verifying = signing.verifying_key();
    println!(
        "MREADER_UPDATE_PRIVKEY={}",
        STANDARD.encode(signing.to_bytes())
    );
    println!(
        "MREADER_UPDATE_PUBKEY={}",
        STANDARD.encode(verifying.to_bytes())
    );
    Ok(())
}

fn cmd_hash(path: &str) -> Result<(), String> {
    let f = File::open(path).map_err(|e| format!("{path}: {e}"))?;
    let (size, sha256) =
        delta_codec::sha256_hex_reader(BufReader::new(f)).map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&ArtifactMeta { size, sha256 }).unwrap()
    );
    Ok(())
}

fn cmd_pack(input: &str, output: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let in_file = File::open(input).map_err(|e| format!("{input}: {e}"))?;
    let out_file = File::create(output).map_err(|e| format!("{output}: {e}"))?;
    delta_codec::pack_reader_to_writer(
        BufReader::new(in_file),
        BufWriter::new(out_file),
        delta_codec::PACK_LEVEL,
    )
    .map_err(|e| e.to_string())?;
    cmd_hash(output)
}

fn cmd_unpack(input: &str, output: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let in_file = File::open(input).map_err(|e| format!("{input}: {e}"))?;
    let out_file = File::create(output).map_err(|e| format!("{output}: {e}"))?;
    let mut writer = BufWriter::new(out_file);
    delta_codec::unpack_reader_to_writer(BufReader::new(in_file), &mut writer)
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    cmd_hash(output)
}

fn cmd_patch(base_path: &str, new_path: &str, out_path: &str) -> Result<(), String> {
    let base = fs::read(base_path).map_err(|e| format!("{base_path}: {e}"))?;
    let target = fs::read(new_path).map_err(|e| format!("{new_path}: {e}"))?;
    let patch = delta_codec::make_patch(&base, &target).map_err(|e| e.to_string())?;

    // Self-verify reconstruction byte-for-byte before accepting the patch.
    let mut reconstructed = Vec::with_capacity(target.len());
    delta_codec::apply_patch_to_writer(&base, Cursor::new(&patch), &mut reconstructed)
        .map_err(|e| format!("self-verify decode failed: {e}"))?;
    if reconstructed != target {
        return Err("self-verify failed: patched bytes do not match target".into());
    }

    if let Some(parent) = Path::new(out_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(out_path, &patch).map_err(|e| format!("{out_path}: {e}"))?;
    cmd_hash(out_path)
}

fn cmd_sign_manifest(manifest_path: &str, out_path: &str) -> Result<(), String> {
    let priv_b64 = env::var("MREADER_UPDATE_PRIVKEY")
        .map_err(|_| "MREADER_UPDATE_PRIVKEY environment variable is required".to_string())?;
    let priv_bytes: [u8; 32] = STANDARD
        .decode(priv_b64.trim())
        .map_err(|_| "Invalid base64 MREADER_UPDATE_PRIVKEY".to_string())?
        .try_into()
        .map_err(|_| "MREADER_UPDATE_PRIVKEY must decode to 32 bytes".to_string())?;
    let signing_key = SigningKey::from_bytes(&priv_bytes);

    let payload = fs::read(manifest_path).map_err(|e| format!("{manifest_path}: {e}"))?;
    let sig = signing_key.sign(&payload);
    let envelope = SignedEnvelope {
        payload: STANDARD.encode(&payload),
        signature: STANDARD.encode(sig.to_bytes()),
    };
    let json = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
    fs::write(out_path, format!("{json}\n")).map_err(|e| format!("{out_path}: {e}"))?;
    Ok(())
}
