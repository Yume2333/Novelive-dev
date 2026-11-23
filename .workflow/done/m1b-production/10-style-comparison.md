# 10: 跑三组画风参考对照

**Effort:** m1b-production
**Executor:** spine (paid calls)
**Blocked by:** 03, 08
**Covers:** W3
**Task type:** spike
**Files:** tests/acceptance/m1b-style.test.ts, .workflow/evidence/m1b/style/
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** 仅串行主线执行 `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1b-style.test.ts` → 相同场景/角色、固定 FXB 跑三组对照，记录图数和盲评。并行会话不领取本任务，严格回放不能替代本 Check。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** ea99733e566c72be5873d6507a07de37ef7b40ba

- [x] 比较单参考、加颜色锁及三参考；得分低仅记录并按证据修订，不擅自改产品默认或放大预算。

## Findings

- 同场景、角色与 FXB 下，单参考加颜色锁与三参考加颜色锁在盲评各项同分（画风／锚点／构图均 3/4）；不锁色组为 3/2/2。每组只有一张，不能用同分推断等效。不改产品默认。

## Progress

- Check after: `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1b-style.test.ts` → `Tests  1 passed (1)`。
- 私有录制严格回放 `Tests  1 passed (1)`；严格 `pnpm check` → `Tests  333 passed (333)`。
- 3 张成图，计费账本中有 4 次图片请求（含 1 次未返回图片的 404）和 1 次视觉评审。实测 33,412 token，含未计量请求的预留共 133,412 token。
- Review: skipped — 当前会话无独立审查工具。
- 凭据：[receipt.txt](../../evidence/m1b/style/receipt.txt)。
