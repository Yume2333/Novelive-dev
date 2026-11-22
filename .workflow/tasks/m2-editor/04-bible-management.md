# 04: 实现设定集和术语候选管理

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/creator/src/bible/editing/, packages/ui/src/pages/bible/, tests/e2e/m2-bible.spec.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 bible and glossary'` → 真实界面查看和接受/拒绝候选，不覆盖已确认内容。

- [ ] 显示跨章节定位和冲突；对候选应用后传播约定的过期标记。
