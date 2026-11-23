# 03: 实现 Agent 会话与提议确认

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/chat/, tests/fixtures/cassettes/m2-chat/, tests/unit/m2-chat.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-chat.test.ts` → 可重开会话树并回放流式、取消、压缩和确认/拒绝。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** 0bf76ad045f9180ed1683ab7a372974519b557e4
**Status:** active

- [ ] 只有对话主控可派子任务且无递归，映射到既定快照/提议持久化，校验过期输入。

## Progress

缺少提供商录制：文本与附图流、压缩摘要、提议工具及拒绝理由回注；取消复用延时的流式录制。已交主线协调录制，本任务只使用严格回放。
