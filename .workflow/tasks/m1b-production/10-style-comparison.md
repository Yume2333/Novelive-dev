# 10: 跑三组画风参考对照

**Effort:** m1b-production
**Executor:** spine (paid calls)
**Blocked by:** 03, 08
**Covers:** W3
**Task type:** spike
**Files:** tests/acceptance/m1b-style.test.ts, .workflow/evidence/m1b/style/
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1b-style.test.ts` → 相同场景/角色、固定 FXB 跑三组对照，记录图数和盲评。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 比较单参考、加颜色锁及三参考；得分低仅记录并按证据修订，不擅自改产品默认或放大预算。
