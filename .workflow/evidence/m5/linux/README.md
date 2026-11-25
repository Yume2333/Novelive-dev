# M5 Linux native acceptance

## Host & Runtime

- Distro: Fedora Linux 45 (Workstation Edition), x86_64
- Kernel: `7.3.3-300.fc45.x86_64 #1 SMP PREEMPT_DYNAMIC`
- CPU: AMD Ryzen 7 8845H w/ Radeon 780M Graphics (16 threads)
- RAM: 30 GiB (available ~23 GiB)
- Host desktop session: GNOME on Wayland (`XDG_SESSION_TYPE=wayland`, `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`)
- Runtime: Node `v24.22.3`, pnpm `12.21.0`, Electron `45.4.1`, electron-builder `26.18.0`

## Unsigned Build & Artifact Verification

- Commands:
  - `node tools/upscale/fetch.mjs linux`
  - `NL_REPLAY=strict pnpm --filter @novelive/desktop run package:linux`
- Local artifact directory (never committed): `apps/desktop/dist/linux-x64-6tDsSv/artifacts/` (unpacked payload at `apps/desktop/dist/linux-x64-6tDsSv/linux-unpacked/novelive`).
- Version: `0.0.0` (matches `apps/desktop/package.json` and `BUILD.txt`).
- `sha256sum -c SHA256SUMS`:
  - `Novelive-0.0.0-linux-x86_64.AppImage`: **OK** — SHA-256 `7826bfa39ac06deb6637e0e508927a6ab6411da01945938f089cb79addb93877`, size `525482331` bytes, SHA-512 `PfpWKEHbnpu7YYdlsLAOdC7+2Q9dH9JId6esYPekFhURWpQBHVkzbiissxwTO3t8WcrreTNVHarsKopw/eKH5A==`
  - `latest-linux.yml`: **OK** — SHA-256 `9adcbf2fa3eb8e23ae18c98fda657b8b57f2d880b9ded387294b85d172ff1eff`
- `latest-linux.yml` consistency: `version: 0.0.0`, `path` / `files[0].url`: `Novelive-0.0.0-linux-x86_64.AppImage`, `size: 525482331`, `sha512`, and `blockMapSize: 538991` all match the built AppImage.
- Extracted resources (`Novelive.AppImage --appimage-extract`):
  - `resources/licenses/LICENSE.txt` (34,523 bytes) and `resources/licenses/THIRD_PARTY_NOTICES.txt` (976,426 bytes)
  - `resources/app.asar` and `resources/app.asar.unpacked/node_modules/@img/sharp-linux-x64/lib/{sharp-linux-x64-0.35.5.node,libvips-cpp.so.8.18.7}`
  - `resources/matting/` and `resources/upscale/`

## AppImage Wrapper Replay Root Cause & Fixes

- **Previous 150s timeout / wrapper failure root cause**:
  1. `apps/desktop/electron-builder.yml` previously set `asar: false`, leaving 35,662 files (~762 MiB `node_modules`) uncompressed in the squashfs payload. Under `APPIMAGE_EXTRACT_AND_RUN=1`, the type2 AppImage runtime printed every extracted path (~38,000 lines / ~5 MB) to stdout before starting `AppRun`, causing slow extraction and overflowing Node's default 1 MiB `execFile` `maxBuffer` (`RangeError: stdout maxBuffer length exceeded`) during the second-instance `.novelive` handoff in `tests/e2e/m5-share.spec.ts`.
  2. Freedesktop `%U` launches (`Exec=AppRun --no-sandbox %U` in `novelive.desktop`) can pass `file://...` URIs (with percent-encoding for spaces/CJK), which `apps/desktop/src/main/file-association/index.ts` previously passed straight to `path.resolve(cwd, arg)`.
- **Fixes applied**:
  - `apps/desktop/electron-builder.yml`: enabled `asar: true` with explicit `asarUnpack` (`**/*.node`, `**/*.so*`, `**/node_modules/sharp/**`, `**/node_modules/@img/**`, `**/node_modules/onnxruntime-node/**`).
  - `tests/e2e/m5-share.spec.ts`: raised second-instance `execFile` `timeout` to `30_000` and `maxBuffer` to `32 * 1024 * 1024`.
  - `apps/desktop/src/main/file-association/index.ts`: added `parsePackageArg(arg, cwd)` using `fileURLToPath` for `file://` URIs before `.novelive` extension matching (unit tests in `tests/unit/m5-file-association.test.ts`).

## Verified Flows on the AppImage Wrapper

All Electron/AppImage checks ran under `NL_REPLAY=strict` with isolated temporary `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `--user-data-dir` profiles (never touching `~/.config/Novelive`).

1. **Full AppImage wrapper share / import / offline-playback / update / fork replay (`tests/e2e/m5-share.spec.ts`)** — **PASS** in the GNOME/Wayland host session against the AppImage wrapper directly (`NL_M5_EXECUTABLE=/tmp/nl-win-06-artifacts/Novelive.AppImage`):
   - FUSE mode: **1 passed** (`9.1s` test / `9.7s` total).
   - Extract-and-run mode (`APPIMAGE_EXTRACT_AND_RUN=1`): **1 passed** (`18.2s` test / `18.8s` total).
   - Earlier preliminary capture set retained in this directory (from unpacked payload on Ubuntu 22.04.5 LTS): [export warning](export-warning.png), [open package](open-package.png), [offline playback](offline-playback.png), [package update review](update-review.png), [preliminary library](appimage-library.png), and [GTK CJK chooser](appimage-gtk-cjk.png).

2. **Isolated XDG Desktop File Association (`xdg-mime` / `xdg-open`)** — **PASS** under `xvfb-run -a dbus-run-session --` (`XDG_CURRENT_DESKTOP=GNOME`, FUSE AppImage, temporary `XDG_DATA_HOME` with installed `novelive.xml` and `novelive.desktop`):
   - AppImage embeds `novelive.desktop` (`Exec=AppRun --no-sandbox %U`, `MimeType=application/vnd.novelive+zip;`) and `usr/share/mime/packages/novelive.xml` (`*.novelive` → `application/vnd.novelive+zip`).
   - `xdg-mime query filetype` → `application/vnd.novelive+zip`; `xdg-mime query default` and `gio mime` → `novelive.desktop`.
   - Cold start via `xdg-open` on a CJK/space filename (`测试 作品 v1.novelive`) launched the AppImage, reported `创作端已就绪`, and opened `v1 · 新作品` import dialog.
   - Deleted the source `测试 作品 v1.novelive` (`ENOENT`), opened the work, and verified offline playback (`你好，世界。` and canvas pixel `[32, 48, 96]`).
   - Invoked `xdg-open` on `测试 作品 v2.novelive` while playing: second-instance forwarding navigated the primary instance to `/`, opened `v1 → v2` review dialog, applied the update, deleted the source v2 archive, and verified updated playback (`新版你好，世界。`).
   - Forwarded `file:///.../uri%20check.novelive`: percent-encoded `file://` URI decoded cleanly and opened `v2 · 已导入` inspection dialog.

3. **Packaged 4-Language UI Switch & Persistence** — **PASS** via Playwright `_electron` directly against the AppImage wrapper (FUSE mode) under `xvfb-run -a`:
   - Switched sequentially `zh-CN` → `zh-TW` → `en` → `ja`, closed and relaunched with the same `--user-data-dir` verifying `<profile>/config.json` persisted `"language": "ja"` and restored `html[lang="ja"]` + `クリエイター準備完了`, then switched back and verified `"language": "zh-CN"` persisted.
   - Across all 12 `(locale, page)` combinations: `html[lang]` and `h1` matched, DOM overflow check returned `[]`, bundled web fonts (`Manrope`, `Hanken Grotesk`, `Noto Sans SC`, `Noto Sans TC`, `Noto Sans JP`) loaded, and visual inspection showed zero missing-glyph boxes or clipping:
     - `zh-CN`: [library](appimage-zh-CN-library.png), [usage](appimage-zh-CN-usage.png), [settings](appimage-zh-CN-settings.png)
     - `zh-TW`: [library](appimage-zh-TW-library.png), [usage](appimage-zh-TW-usage.png), [settings](appimage-zh-TW-settings.png)
     - `en`: [library](appimage-en-library.png), [usage](appimage-en-usage.png), [settings](appimage-en-settings.png)
     - `ja`: [library](appimage-ja-library.png), [usage](appimage-ja-usage.png), [settings](appimage-ja-settings.png)

4. **Update Feed & Linux Platform Branches** — **PASS** under `xvfb-run -a` against a local `http://127.0.0.1:<port>/` feed (`NL_UPDATE_URL`) plus unit tests (`tests/unit/m5-update-install.test.ts`):
   - **AppImage same version (`0.0.0` vs `0.0.0`)**: fetched `GET /latest-linux.yml` only; prompted `已是最新版本。`.
   - **AppImage newer version (`0.0.0` → `0.0.1`)**: fetched `GET /latest-linux.yml` then `GET /Novelive-0.0.1-linux-x86_64.AppImage`, SHA-512 verified download, and prompted `版本 0.0.1 已下载，可以重启安装。` (`['稍后', '重启安装']`). (Unit test also verified read-only AppImage directory blocks `quitAndInstall` with error prompt.)
   - **Non-AppImage Linux `deb` branch (`0.0.0` → `0.0.1`)**: ran `linux-unpacked/novelive` with `APPIMAGE` unset against `latest-linux.yml` listing `.AppImage` and `.deb`; fetched `GET /latest-linux.yml` only (no download), prompted `版本 0.0.1 已可用，请手动下载。` (`['稍后', '打开下载']`), and invoked `shell.openExternal('http://127.0.0.1:<port>/Novelive-0.0.1-linux-amd64.deb')` upon confirmation.

## Honest Caveats & Out-of-Scope Notes

- **Display environment split**: `m5-share.spec.ts` (FUSE and `APPIMAGE_EXTRACT_AND_RUN=1`) ran directly in the host GNOME Wayland/XWayland session; the isolated XDG `xdg-open` file-association harness, 4-language AppImage visual sweep, and local HTTP update checks ran under `xvfb-run -a` (with `dbus-run-session` for XDG/MIME).
- **Desktop integration scope**: `.novelive` file association was verified end-to-end via `xdg-mime` / `xdg-open` against an isolated `XDG_DATA_HOME` desktop entry pointing to the AppImage; no system-wide AppImage launcher (e.g. AppImageLauncher) or graphical file manager double-click on Windows/macOS was tested here (Windows/macOS are out of Linux scope).
- **Host GTK font prerequisite**: The GTK native file chooser uses OS fonts rather than renderer web fonts; distros lacking CJK system fonts still require `fonts-noto-cjk` (or equivalent) installed on the host.
- **Linux `.deb` packaging**: M5 does not produce a `.deb` artifact; the `deb` manual-download branch was verified using `linux-unpacked/novelive` (`APPIMAGE` unset) against a local test feed and via `vitest` unit tests.
