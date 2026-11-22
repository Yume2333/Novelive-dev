# 10: 构建并实测 macOS 安装包

**Effort:** m5-delivery
**Blocked by:** 06, 07
**Covers:** W3
**Files:** .workflow/evidence/m5/macos/
**Read first:** `.workflow/specs/m5-delivery.md`、`docs/architecture.md` 自动更新。
**Check:** `pnpm --filter @novelive/desktop run package:macos` → 从 DMG 安装，双击作品包离线播放；验证 zip 产物及未签名时仅提示手动下载。

- [ ] 在 macOS 记录运行环境、产物版本/校验和/获取位置及流程回执，不提交二进制。
