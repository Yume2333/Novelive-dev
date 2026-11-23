# 07: 验证真卷分块综合和真书工程

**Effort:** m1a-project
**Blocked by:** 06
**Covers:** W4
**Executor:** spine (paid calls)
**Task type:** spike
**Files:** tests/acceptance/m1a-owner-book.test.ts, .workflow/evidence/m1a/owner/
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** 仅串行主线执行 `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1a-owner-book.test.ts` → 按 W4 写脱敏的差异、耗费和重启报告。并行会话不领取本任务，严格回放不能替代本 Check。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** ea99733e566c72be5873d6507a07de37ef7b40ba
**Status:** active

- [ ] 仅使用所有者在 ~/novelive-testbooks/ 放入、且可用中转处理的选书；将录制目录设在仓库外，不提交原文/请求/私有模型结果。没有书则记录阻塞，不暂停后续不依赖真书的建设。

## Progress

- 按本轮授权自行选用公版《野叟曝言》，实导入 20 卷／154 回。
- Check after: `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1a-owner-book.test.ts` → `Tests  1 failed (1)`。DeepSeek 禁用探针仍输出推理；已改用 Gemini 完成首卷 7 回预览及卷摘要。第一包综合的初始及修复响应未通过 schema，整卷对照、已确认设定和重启保持未验收。
- 严格 `pnpm check` → `Tests  342 passed (342)`。累计付费 20 次、190,995 tokens、0 张图。
- [脱敏凭据](../../evidence/m1a/owner/receipt.txt)
- 部分交付：schema 契约修复的严格检查为 `Tests  344 passed (344)`。复用首卷预览，第一包综合已保存；第二包修复报 `reasoning_limit`。W4 未通过。
- 未完成：[#68](https://github.com/Yume2333/Novelive-dev/pull/68) 三次整卷共识阈值 0.90；目前 0.80–0.85，缺 `chunked-run.json`、重启零调用、CI 和 review，交接已停付费。
