# 05: 建立安装、更新与许可产物

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W3
**Files:** apps/desktop/electron-builder.yml, apps/desktop/package.json, apps/desktop/src/main/update/, tools/licenses/, .github/workflows/package.yml, tests/integration/m5-update.test.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-update.test.ts` → 每平台更新策略通过本地可重现的元数据测试，生成许可并保留 Electron 原始许可。
**Base commit:** e10725ed62a8c41308a373b35d1a7fc6d92aa5cb

- [x] 提供 package:linux、package:windows、package:macos 三条原生构建命令输出未签名 AppImage、NSIS、DMG+zip；不用公开 Release；保留证据和产物但不把安装包入 Git。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-update.test.ts` — 7 passed；`NL_REPLAY=strict pnpm exec vitest run tests/unit/m5-verify-artifacts.test.ts` — 6 passed。
- 三平台 CI 原生打包与校验全部通过（[Native packages #45556159242](https://github.com/Yume2333/Novelive-dev/actions/runs/45556159242)，commit `1ac35cb0eaeb78c10355c00473a7112f00e7fb2c`）：Linux (`ubuntu-24.04` AppImage + `latest-linux.yml`)、Windows (`windows-2025` NSIS + `latest.yml`)、macOS (`macos-15-arm64` DMG + ZIP + `latest-mac.yml`) 均通过 `SHA256SUMS` 与许可产物核验（含 `LICENSE.txt`、`THIRD_PARTY_NOTICES.txt`、`LICENSE.electron.txt`、`LICENSES.chromium.html`）。
- 证据目录：[Linux](../../evidence/m5/packaging/linux.md)、[Windows](../../evidence/m5/windows/README.md)、[macOS](../../evidence/m5/macos/README.md)。
- Review: pass (base e10725ed62a8c41308a373b35d1a7fc6d92aa5cb, reviewer win-verify.m5-05-independent-review) — 三项 nonblocking 建议已记录（保留不阻塞归档）。
