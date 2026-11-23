# 11: 验收所有者选书的完整制作

**Effort:** m1b-production
**Executor:** spine (paid calls)
**Blocked by:** 09, 10
**Covers:** W4
**Task type:** spike
**Files:** .workflow/evidence/m1b/owner/
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** 仅串行主线执行 `NL_REPLAY=record pnpm dev` → 使用授权真书导入、确认、试玩、继续制作并记录作品验收和用量。并行会话不领取本任务，严格回放不能替代本 Check。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 一个所有者选书完整真跑；将录制目录设在仓库外，不提交原文/请求/私有模型结果。没有资料或余额则记录阻塞，不以合成用例替代。

## Progress

M1a 恢复与综合代码已在 `f9dd863` 合入 main（[#86](https://github.com/Yume2333/Novelive-dev/pull/86)），满足本任务的代码前提。M1a/07 的 0.90 门槛仍未通过，待[所有者评审](../../owner-review.md)，不再付费跑 M1a W4；该比较验收不再是本任务的前置。本任务的真书验收仍须由获授权的串行主线按原 Check 执行，尚未启动付费。
