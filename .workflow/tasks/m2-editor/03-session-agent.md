# 03: 实现 Agent 会话与提议确认

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/chat/, tests/fixtures/cassettes/m2-chat/, tests/unit/m2-chat.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-chat.test.ts` → 可重开会话树并回放流式、取消、压缩和确认/拒绝。

- [ ] 只有对话主控可派子任务且无递归，映射到既定快照/提议持久化，校验过期输入。
