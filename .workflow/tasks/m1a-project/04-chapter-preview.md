# 04: 全书预览与卷摘要

**Effort:** m1a-project
**Blocked by:** 01
**Covers:** W3
**Files:** packages/creator/src/preview/, tests/fixtures/cassettes/m1a-preview/, tests/unit/m1a-preview.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-preview.test.ts` → 严格回放覆盖拆段、不截断、汇总与重启恢复。

- [ ] 每章读完，按卷生成 digest，并保留人物、地点、时间线和伏笔。
