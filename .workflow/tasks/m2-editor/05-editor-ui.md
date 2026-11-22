# 05: 实现编辑器、原文对照与舞台预览

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W1, W3
**Files:** packages/ui/src/pages/editor/, tests/e2e/m2-editor.spec.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor preview'` → 真实界面在固定工程定位原文和当前句，编辑、撤销及预览。

- [ ] 复用播放器，在 CodeMirror 实现文本效果和快捷位置，展示差异列表与标记提议横幅。
