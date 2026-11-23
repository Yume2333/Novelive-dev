# M5/05 Linux packaging check

- Host: Ubuntu 22.04.5 LTS x64; Novelive 0.0.0, Electron 45.4.1.
- Build: `pnpm --filter @novelive/desktop run package:linux`. Local artifacts: `apps/desktop/dist/linux-x64-bt3Sed/artifacts/` (not tracked); `sha256sum -c SHA256SUMS` reported both the AppImage and `latest-linux.yml` OK.
- AppImage SHA-256: `ee02f37623c851a10fc53315762d5f226b8fabda0cd772cf6f2534b066fff8a0`.
- An AppImage launch under Xvfb with `APPIMAGE_EXTRACT_AND_RUN=1` confirmed the packaged About version/notices, a successful sharp decode, and a same-version request to local `latest-linux.yml` without an installer download. The unpacked build also contains `LICENSE.electron.txt`, `LICENSES.chromium.html`, `licenses/LICENSE.txt` and `licenses/THIRD_PARTY_NOTICES.txt`.
- This is not W3 acceptance: no new-version install, .novelive import/playback, or Windows/macOS native run was performed.
