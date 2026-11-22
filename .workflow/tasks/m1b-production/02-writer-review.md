# 02: 实现写手、审稿及演出脚本

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2, W3
**Files:** packages/creator/src/pipeline/writing/, tests/fixtures/cassettes/m1b-writer/, tests/unit/m1b-writer.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-writer.test.ts` → 源文检查、修订、分段、优先章衔接与脚本诊断通过。

- [ ] 忠实默认开且核验真实引文、文风可选，每次只修一轮；覆盖改编/演出密度、红线和源段范围。
