# 08: 构建并实测 Linux 安装包

**Effort:** m5-delivery
**Blocked by:** 06, 07
**Covers:** W3
**Files:** .workflow/evidence/m5/linux/
**Read first:** `.workflow/specs/m5-delivery.md`、`docs/architecture.md` 自动更新。
**Check:** `pnpm --filter @novelive/desktop run package:linux` → 实际运行生成的 AppImage，打开作品包并离线播放；验证 AppImage 更新和 deb 手动提示分支。

- [ ] 在 Linux 记录运行环境、产物版本/校验和/获取位置及流程回执，不提交二进制。
