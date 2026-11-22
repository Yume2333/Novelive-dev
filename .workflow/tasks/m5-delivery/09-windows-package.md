# 09: 构建并实测 Windows 安装包

**Effort:** m5-delivery
**Blocked by:** 06, 07
**Covers:** W3
**Files:** .workflow/evidence/m5/windows/
**Read first:** `.workflow/specs/m5-delivery.md`、`docs/architecture.md` 自动更新。
**Check:** `pnpm --filter @novelive/desktop run package:windows` → 实际安装 NSIS 包，双击作品包离线播放，验证 NSIS 更新和卸载。

- [ ] 在 Windows 记录运行环境、产物版本/校验和/获取位置及流程回执，不提交二进制。
