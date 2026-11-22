# 02: 实现手工编辑、规则及修改历史

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W1, W3
**Files:** packages/creator/src/editor/history/, packages/creator/src/editor/rules/, packages/format/src/script/editing/, tests/unit/m2-history.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-history.test.ts` → 真实工程中 ID 稳定、修改可审计、撤销范围和章规则优先正确。

- [ ] 支持文本/标记、表情和规则；重开只读持久历史，按版本核验写前输入。
