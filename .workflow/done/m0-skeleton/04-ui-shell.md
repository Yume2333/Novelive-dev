# 04: 移植共用控件与书库外壳

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W5, W6
**Files:** packages/ui/src/components/, packages/ui/src/styles/, packages/ui/src/shell/, packages/ui/src/pages/library/, packages/ui/src/pages/usage/, tests/e2e/m0-ui-shell.spec.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm check && pnpm test:e2e --grep 'M0 library and usage'` → Electron 可打开空书库和用量并切换主题，无原生滚动条。
**Base commit:** a156b754a33242e59b00c194898964c99419cec0

- [x] 从原型移植设计 Tokens/控件，样式转换为 CSS Modules；不移植假数据。
- [x] 侧栏全局导航、主题、空书库/用量；由 09 提供模型设置页面。

## Progress

- Check before: 基线 a156b75 仅有空书库占位。
- Check after: 指定命令通过。[检查日志](../../evidence/m0-skeleton/04-ui-check.txt)
- Real path: Electron 开发入口打开空书库、切换用量和暗色主题。[实际运行输出](../../evidence/m0-skeleton/04-ui-real-path.txt) · [亮色书库](../../evidence/m0-skeleton/04-library-light.png) · [暗色用量](../../evidence/m0-skeleton/04-usage-dark.png)
- Review: skipped — 本会话未进行独立工作流/安全审查或 W5 原型截图对照。
