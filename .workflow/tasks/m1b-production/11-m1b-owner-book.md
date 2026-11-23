# 11: 验收所有者选书的完整制作

**Effort:** m1b-production
**Executor:** spine (paid calls)
**Blocked by:** 09, 10
**Covers:** W4
**Task type:** spike
**Files:** .workflow/evidence/m1b/owner/
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** 仅串行主线执行 `NL_REPLAY=record pnpm dev` → 在 Electron 导入《野叟曝言》，使用整卷综合（指纹一致时复用预览与综合），确认主视觉、试玩第一章、手动继续制作并验证后续章发布；记录质量与用量（最多 40 张图、20M tokens）。并行会话不领取本任务，严格回放不能替代本 Check。

本任务只验收整卷制作路径。M1a/07 的分块 F1 仍是 [owner-review](../../owner-review.md) 中的开放项，另行处理，不阻塞本任务。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** 1a1d5ed1c3af1784f0c1f0dc85c22013ddd122f4
**Status:** blocked

## Blocked

真实 Electron 已通过首卷整卷综合、主视觉确认及首章忠实度审核。首章从演出阶段复验时已发起素材 ID 格式修复，但模型连接中断，制作暂停并标记「需要处理」。未达到首章发布、试玩或后续制作。此阻塞与 M1a 的分块 F1 无关。

## Progress

- Check after: `NL_REPLAY=record pnpm dev` → 真书导入、7 回预览复用已验证；制作页显示「创作端命令失败」，未到达主视觉确认、首章试玩或继续制作。3 次付费文本请求、56,284 实测 tokens、0 张图；已停止付费。
- 复验：基于 `f8845c6` 以 `NL_REPLAY=record pnpm dev` 恢复项目，复用 7 回预览并发布首卷整卷综合。首张主视觉候选通过；第二张因画风审核未通过停止。累计 12 次请求、98,594 实测 tokens、2 张图。严格 `pnpm check`：43 个文件通过，562 个测试通过、1 个跳过；严格回放未替代真跑。
- 主视觉修复 `7f4ff39` 后真跑复用 7 回预览、整卷综合和首张主视觉候选；补齐两张候选并确认第一张。首章忠实度审核终止于 `Fidelity review did not submit valid source citations within its request budget`，发布 0/7 章。累计 80 次请求、359,634 实测 tokens、4 张图，已停止付费。修复分支严格 `pnpm check`：43 个文件通过，563 个测试通过、1 个跳过。
- 忠实度引证修复 `c65487d` 后，在真实 Electron 中复用已保存结果并从首章审核重试。审核通过；演出清单的两个素材 ID 未通过格式校验，发布仍为 0/7 章。累计 172 次请求、811,281 实测 tokens、4 张图，无未结预留，已停止付费。
- 演出素材 ID 修复 `6b6d3ab` 后，在真实 Electron 中从首章演出重试，复用已审核草稿和两次已录制的演出响应。新的演出修复请求终止于 `[network] Model connection interrupted or unavailable`，发布仍为 0/7 章。累计已入账 180 次请求、1,050,560 实测 tokens、4 张图，已停止付费。
- 证据：[脱敏收据](../../evidence/m1b/owner/11-real-book-gate.md)。

- [ ] 一个所有者选书完整真跑；将录制目录设在仓库外，不提交原文/请求/私有模型结果。没有资料或余额则记录阻塞，不以合成用例替代。
