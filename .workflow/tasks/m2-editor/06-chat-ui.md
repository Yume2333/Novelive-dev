# 06: 接通可盖层的流式 Agent 面板

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W2
**Files:** packages/ui/src/panels/agent/, tests/e2e/m2-chat.spec.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 chat panel'` → 真实界面能贴图、查看工具细节、暂停或切换会话及分支。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 支持全屏切换与快捷键；确认卡说明影响范围、可拒绝并填写理由。
