# 10: 构建并实测 macOS 安装包

**Effort:** m5-delivery
**Blocked by:** 06, 07
**Covers:** W3
**Files:** .workflow/evidence/m5/macos/
**Read first:** `.workflow/specs/m5-delivery.md`、`docs/architecture.md` 自动更新。
**Check:** `pnpm --filter @novelive/desktop run package:macos` → 从 DMG 安装，双击作品包离线播放；验证 zip 产物及未签名时仅提示手动下载。
**Base commit:** 1ac35cb0eaeb78c10355c00473a7112f00e7fb2c

- [x] 在 macOS 记录运行环境、产物版本/校验和/获取位置及流程回执，不提交二进制。

## Progress

- 已在 CI 原生 `macos-15-arm64`（macOS `15.8.2` `24H232`）跑通（[Native packages #45556159242](https://github.com/Yume2333/Novelive-dev/actions/runs/45556159242)，commit `1ac35cb0eaeb78c10355c00473a7112f00e7fb2c`，回执见 [macOS](../../evidence/m5/macos/README.md)）：`package:macos` 输出 `.dmg`、`.zip` 与 `latest-mac.yml` 并通过 `SHA256SUMS` / SHA-512 校验；完成 `hdiutil` 挂载 DMG 与拷贝、`Info.plist` `.novelive` `CFBundleDocumentTypes` 检查、资源与 Electron 许可检查、`Contents/MacOS/Novelive` 导入 `.novelive` 删包离线播放、`m5-share.spec.ts` 迁移全流程，以及未签名 `99.0.0` 手动下载提示验证（不自动下载）。
- 尚未实测（保持未关闭）：（1）物理 Finder 图形界面双击 `.novelive` 与 LaunchServices `open-file` AppleEvent 分发（本轮仅测命令行传参与 `Info.plist` 静态核验）；（2）`.zip` 产物解压后直接启动运行（本轮仅校验 `.zip` 的 `SHA256SUMS` 与 `latest-mac.yml` SHA-512）。
- Check after: CI `macos-15-arm64` run `45556159242` 上 `package:macos` exit 0，DMG SHA-256 `ad463ef2d9527d4cd59195f41dc1c6bb1d04d4627e3217f96276823de865e6b3`，挂载拷贝、`Info.plist` 关联、离线播放、未签名手动下载提示通过（见 [macOS](../../evidence/m5/macos/README.md)）。
- Check waived: 物理 Finder 双击 / LaunchServices `open-file` 与 `.zip` 解压直接启动不再实测；所有者；2026-11-26
- Review: skipped — 所有者 2026-11-26 指示免除物理真机项并直接通过；只含证据文件。
