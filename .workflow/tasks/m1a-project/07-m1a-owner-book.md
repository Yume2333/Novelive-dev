# 07: 验证真卷分块综合和真书工程

**Effort:** m1a-project
**Blocked by:** 06
**Covers:** W4
**Executor:** spine (paid calls)
**Task type:** spike
**Files:** tests/acceptance/m1a-owner-book.test.ts, .workflow/evidence/m1a/owner/
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1a-owner-book.test.ts` → 按 W4 写脱敏的差异、耗费和重启报告。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 仅使用所有者在 ~/novelive-testbooks/ 放入、且可用中转处理的选书；将录制目录设在仓库外，不提交原文/请求/私有模型结果。没有书则记录阻塞，不暂停后续不依赖真书的建设。
