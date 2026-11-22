# 10: 录制并脱敏真实模型验收

**Effort:** m0-skeleton
**Blocked by:** 06, 09
**Covers:** W3
**Executor:** spine (paid calls)
**Files:** tests/fixtures/cassettes/, .workflow/evidence/m0/live/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** 仅串行主线执行 `NL_REPLAY=record pnpm dev` → 按 W3 逐个操作三文本协议和三图片能力；保存脱敏回放及截图。并行会话不领取本任务，严格回放不能替代本 Check。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** 62fb4b9d92a0de5149a56e6e99f7d21f3cca1b5d

- [x] 守用量计划，由单一执行者使用私有 relay；覆盖 auth 与 moderation（没有原生 moderation 时用规格允许的等价注入）。
- [x] 退出重开检查配置；回放不含授权头、中转地址或真实私有输入。
- [x] 07/12 的最小 smoke 已通过各自的显式目录供 09 严格回放；本任务在 09 接线后从真实设置页向默认 `tests/fixtures/cassettes/` 完成 W3，不为 09 补录前置 cassette。复用可用 smoke，额外调用与 07/12 共用 M0 用量上限。

## Progress

- Check after: `NL_REPLAY=record pnpm dev`；Electron 设置页三个文本连接和三项图片能力成功；错误 Key 返回 401。审核探测未触发 relay 拦截，采用规格允许的等价注入。[录制、审计和用量凭据](../../evidence/m0/live/10-w3-check.txt) · [实录截图](../../evidence/m0/live/10-w3-settings.png)
- Real path: 退出重开后配置保留；严格回放 W3 成功及错误用例，并验证图片缩略图正常加载。`pnpm check` 129 项、`pnpm test:e2e` 13 项通过。[重开与回放凭据](../../evidence/m0/live/10-w3-real-path.txt) · [回放截图](../../evidence/m0/live/10-w3-reopened.png) · [审核错误截图](../../evidence/m0/live/10-w3-errors.png)
- 视觉探测改为要求简述图片。视觉 smoke 复用 W3 的同一次实录；其他 smoke 不变。8 次调用已逐条写入私有用量账本，合计 22,455 tokens、3 张图片。
- Review: pass (base 62fb4b9d92a0de5149a56e6e99f7d21f3cca1b5d, reviewer Devin Review) — [PR #13](https://github.com/Yume2333/Novelive-dev/pull/13) 独立审查通过。
