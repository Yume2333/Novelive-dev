# 07: 接通重写场景、单图重画与重跑

**Effort:** m2-editor
**Blocked by:** 02, 03
**Covers:** W3
**Files:** packages/creator/src/editor/revisions/, tests/fixtures/cassettes/m2-revisions/, tests/unit/m2-revisions.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-revisions.test.ts` → 实际工程只应用勾选的重写，重画保留旧版本历史，重跑范围正确。

- [ ] 复用写手、出图与综合管线。设置、重写、重图和重做章节都按输入版本在写前再次校验。
