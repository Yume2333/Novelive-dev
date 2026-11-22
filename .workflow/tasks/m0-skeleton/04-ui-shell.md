# 04: 移植共用控件与书库外壳

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W5, W6
**Files:** packages/ui/src/components/, packages/ui/src/styles/, packages/ui/src/shell/, packages/ui/src/pages/library/, packages/ui/src/pages/usage/, tests/e2e/m0-ui-shell.spec.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm check && pnpm test:e2e --grep 'M0 library and usage'` → Electron 可打开空书库和用量并切换主题，无原生滚动条。

- [ ] 从原型移植设计 Tokens/控件，样式转换为 CSS Modules；不移植假数据。
- [ ] 侧栏全局导航、主题、空书库/用量；由 09 提供模型设置页面。
