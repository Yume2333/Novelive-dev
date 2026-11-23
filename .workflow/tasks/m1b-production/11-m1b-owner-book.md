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

真实 Electron 制作在首卷整卷综合处停止：Gemini 的修复响应仍有 24 个角色条目缺少必填 `aliases`，未通过现有 schema。私有严格回放复现同一错误；先离线修复并验证整卷输出，再恢复真跑。此阻塞与 M1a 的分块 F1 无关。

## Progress

- Check after: `NL_REPLAY=record pnpm dev` → 真书导入、7 回预览复用已验证；制作页显示「创作端命令失败」，未到达主视觉确认、首章试玩或继续制作。3 次付费文本请求、56,284 实测 tokens、0 张图；已停止付费。
- 证据：[脱敏收据](../../evidence/m1b/owner/11-real-book-gate.md)。

- [ ] 一个所有者选书完整真跑；将录制目录设在仓库外，不提交原文/请求/私有模型结果。没有资料或余额则记录阻塞，不以合成用例替代。
