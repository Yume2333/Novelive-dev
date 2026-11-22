# 05: 建立安装、更新与许可产物

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W3
**Files:** apps/desktop/electron-builder.yml, apps/desktop/package.json, apps/desktop/src/main/update/, tools/licenses/, .github/workflows/package.yml, tests/integration/m5-update.test.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-update.test.ts` → 每平台更新策略通过本地可重现的元数据测试，生成许可并保留 Electron 原始许可。

- [ ] 提供 package:linux、package:windows、package:macos 三条原生构建命令输出未签名 AppImage、NSIS、DMG+zip；不用公开 Release；保留证据和产物但不把安装包入 Git。
