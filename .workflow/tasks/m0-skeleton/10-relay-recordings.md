# 10: 录制并脱敏真实模型验收

**Effort:** m0-skeleton
**Blocked by:** 06, 09
**Covers:** W3
**Files:** tests/fixtures/cassettes/, .workflow/evidence/m0/live/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=record pnpm dev` → 按 W3 逐个操作三文本协议和三图片能力；保存脱敏回放及截图。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 守用量计划，由单一执行者使用私有 relay；覆盖 auth 与 moderation（没有原生 moderation 时用规格允许的等价注入）。
- [ ] 退出重开检查配置；回放不含授权头、中转地址或真实私有输入。
- [ ] 07/08 的最小 smoke 已供 09 严格回放；本任务在 09 接线后从真实设置页完成 W3，不为 09 补录前置 cassette。复用可用 smoke，额外调用与 07/08 共用 M0 用量上限。
