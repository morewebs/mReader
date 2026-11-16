# mReader

A quiet, monochrome, cross-platform RSS reader built with Tauri 2, Rust, SQLite, and React.

## Design Philosophy

Most feed readers turn reading into an inbox chore: three cramped panes, unread count badges competing for attention, and dense walls of text. **mReader** stays intentionally calm:

- **Monochrome hierarchy:** State is expressed strictly through luminance, font weight, hairlines, and subtle geometric markers across two surfaces — **Ink** (dark) and **Paper** (light).
- **Two-space focus:** A centered editorial stream (`Today`, `Yesterday`, `This week`, `Earlier`) with 2-beat item anatomy (quiet source line, crisp headline, optional single-line deck) opens into a distraction-free reading canvas.
- **Full-article reader mode:** Expands truncated RSS teasers by fetching and extracting the source page's main prose in Rust (`scraper` + `ammonia` HTML sanitization).
- **Local-first storage:** Feeds, articles, cached full text, and preferences live in SQLite via `rusqlite` with conditional `ETag` / `Last-Modified` syncing.

## Platform Support

- **Windows** (`x86_64` NSIS installer & MSI)
- **Linux** (`x86_64` AppImage & `.deb`)
- **Android** (`universal` & `arm64` APKs, minSdk 26)

## Development

```bash
npm install
npm test          # Vitest frontend suite
npm run build     # TypeScript + Vite production bundle
npm run desktop   # Tauri desktop app (Windows / Linux)
```

Rust backend checks:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Android development:

```bash
npx tauri android dev
npx tauri android build --apk
```

## GitHub Actions CI & Release

- **CI** (`.github/workflows/ci.yml`): Runs frontend checks (`tsc`, `vitest`, `vite build`), Rust formatting/clippy/unit tests on Ubuntu and Windows, and Android compilation checks (`cargo check` + `tauri android build`).
- **Release** (`.github/workflows/release.yml`): Triggered on `v*` tags (or manual `workflow_dispatch` dry runs). Builds Windows (`.exe`, `.msi`), Linux (`.AppImage`, `.deb`), and Android (`.apk`) artifacts, computes `SHA256SUMS.txt`, and publishes a GitHub Release on tags.
  - Optional Android release signing secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without these secrets, Android APKs are signed with the Android debug keystore so they remain sideloadable during testing.
  - Built-in delta updates: `release.yml` builds multi-base zstd dictionary patches (against up to the last 5 releases) via `scripts/delta-tool` and signs `mreader-update.json` with Ed25519. To enable built-in updates, generate a keypair with:
    ```bash
    cargo run --manifest-path scripts/delta-tool/Cargo.toml -- keygen
    ```
    Then add `MREADER_UPDATE_PUBKEY` and `MREADER_UPDATE_PRIVKEY` to GitHub repository secrets. Without these secrets, builds remain unsigned and in-app update checking stays safely disabled.
