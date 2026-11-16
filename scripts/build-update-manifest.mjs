import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key?.startsWith("--") || val === undefined) {
      throw new Error(`Invalid argument pair near ${key ?? ""}`);
    }
    out[key.slice(2)] = val;
  }
  return out;
}

function runTool(tool, args) {
  const stdout = execFileSync(tool, args, { encoding: "utf8" }).trim();
  if (!stdout) return null;
  return JSON.parse(stdout);
}

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

const TARGET_SPECS = [
  {
    key: "windows-x86_64",
    rawFile: "mReader-win-x64.exe",
    packedFile: "mReader-win-x64.exe.zst",
    installerFile: "mReader-Setup-x64.exe",
    patchPrefix: "mReader-win-x64",
  },
  {
    key: "linux-x86_64-appimage",
    rawFile: "mReader-x86_64.AppImage",
    packedFile: "mReader-x86_64.AppImage.zst",
    installerFile: "mReader-x86_64.AppImage",
    patchPrefix: "mReader-linux-appimage",
  },
  {
    key: "linux-x86_64-bin",
    rawFile: "mReader-linux-x64",
    packedFile: "mReader-linux-x64.zst",
    installerFile: "mReader-amd64.deb",
    patchPrefix: "mReader-linux-bin",
  },
  {
    key: "android-arm64",
    rawFile: "mReader-arm64.apk",
    packedFile: "mReader-arm64.apk.zst",
    installerFile: "mReader-arm64.apk",
    patchPrefix: "mReader-android-arm64",
  },
  {
    key: "android-universal",
    rawFile: "mReader-universal.apk",
    packedFile: "mReader-universal.apk.zst",
    installerFile: "mReader-universal.apk",
    patchPrefix: "mReader-android-universal",
  },
];

function fetchPreviousTags(currentTag, maxHistory = 5) {
  try {
    const raw = runGh(["release", "list", "--limit", "20", "--json", "tagName,isDraft"]);
    const list = JSON.parse(raw);
    return list
      .filter((r) => !r.isDraft && r.tagName && r.tagName !== currentTag && r.tagName.startsWith("v"))
      .slice(0, maxHistory)
      .map((r) => r.tagName);
  } catch {
    return [];
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { repo, version, tag, "assets-dir": assetsDir, tool } = args;
  if (!repo || !version || !tag || !assetsDir || !tool) {
    throw new Error(
      "Usage: node scripts/build-update-manifest.mjs --repo owner/name --version 0.2.0 --tag v0.2.0 --assets-dir publish-assets --tool delta-tool"
    );
  }

  const work = mkdtempSync(join(tmpdir(), "mreader-delta-"));
  try {
    const prevTags = fetchPreviousTags(tag, 5);
    const targets = {};

    for (const spec of TARGET_SPECS) {
      const rawPath = join(assetsDir, spec.rawFile);
      if (!existsSync(rawPath)) continue;

      const rawMeta = runTool(tool, ["hash", rawPath]);
      const packedPath = join(assetsDir, spec.packedFile);
      const packedMeta = existsSync(packedPath)
        ? runTool(tool, ["hash", packedPath])
        : runTool(tool, ["pack", rawPath, packedPath]);

      const patches = [];
      for (const prevTag of prevTags) {
        const prevVer = prevTag.replace(/^v/, "");
        const prevDir = join(work, prevTag);
        mkdirSync(prevDir, { recursive: true });
        const prevPacked = join(prevDir, spec.packedFile);
        const prevRaw = join(prevDir, spec.rawFile);

        let baseFile = null;
        try {
          execFileSync(
            "gh",
            ["release", "download", prevTag, "--pattern", spec.packedFile, "--dir", prevDir],
            { stdio: "ignore" }
          );
          if (existsSync(prevPacked)) {
            runTool(tool, ["unpack", prevPacked, prevRaw]);
            baseFile = prevRaw;
          }
        } catch {
          try {
            execFileSync(
              "gh",
              ["release", "download", prevTag, "--pattern", spec.rawFile, "--dir", prevDir],
              { stdio: "ignore" }
            );
            if (existsSync(prevRaw)) {
              baseFile = prevRaw;
            }
          } catch {
            // Previous release didn't ship this target asset.
          }
        }

        if (!baseFile) continue;

        const baseMeta = runTool(tool, ["hash", baseFile]);
        const patchName = `${spec.patchPrefix}-from-${prevVer}.patch.zst`;
        const patchPath = join(assetsDir, patchName);

        try {
          const patchMeta = runTool(tool, ["patch", baseFile, rawPath, patchPath]);
          // Keep delta only when it saves substantial bandwidth (< 75% of packed full package).
          if (patchMeta.size < Math.floor(packedMeta.size * 0.75)) {
            patches.push({
              fromVersion: prevVer,
              fromSha256: baseMeta.sha256,
              patchUrl: `https://github.com/${repo}/releases/download/${tag}/${patchName}`,
              patchSha256: patchMeta.sha256,
              patchSize: patchMeta.size,
            });
            console.log(
              `[delta] ${spec.key} ${prevVer} -> ${version}: ${patchMeta.size} B (vs ${packedMeta.size} B packed, ${rawMeta.size} B full)`
            );
          } else {
            rmSync(patchPath, { force: true });
            console.log(
              `[delta] skipped ${spec.key} ${prevVer} -> ${version} (${patchMeta.size} B >= 75% of packed ${packedMeta.size} B)`
            );
          }
        } catch (err) {
          rmSync(patchPath, { force: true });
          console.warn(`[delta] failed ${spec.key} from ${prevVer}: ${err.message}`);
        }
      }

      const installerExists = spec.installerFile && existsSync(join(assetsDir, spec.installerFile));
      targets[spec.key] = {
        targetSha256: rawMeta.sha256,
        targetSize: rawMeta.size,
        packedUrl: `https://github.com/${repo}/releases/download/${tag}/${spec.packedFile}`,
        packedSize: packedMeta.size,
        installerUrl: installerExists
          ? `https://github.com/${repo}/releases/download/${tag}/${spec.installerFile}`
          : null,
        patches,
      };
    }

    const manifest = {
      schema: 1,
      version,
      publishedAt: new Date().toISOString(),
      releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
      notes: null,
      targets,
    };

    const rawManifestPath = join(work, "raw-manifest.json");
    writeFileSync(rawManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    if (!process.env.MREADER_UPDATE_PRIVKEY?.trim()) {
      console.log("::warning::MREADER_UPDATE_PRIVKEY not set; skipping mreader-update.json signing.");
      return;
    }

    const signedOut = join(assetsDir, "mreader-update.json");
    execFileSync(tool, ["sign-manifest", rawManifestPath, signedOut], { stdio: "inherit" });
    console.log(`Signed update manifest written to ${signedOut}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
