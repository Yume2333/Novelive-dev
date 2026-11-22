# 07: 接通文本和视觉模型测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/text/, tests/unit/m0-text.test.ts, tests/fixtures/text-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict NL_CASSETTE_DIR=tests/fixtures/text-models/synthetic/ pnpm exec vitest run tests/unit/m0-text.test.ts` → 用 03 的回放层接入合成 cassette 和故障注入，覆盖三种协议及带图视觉测试的成功、错误、重试、取消；不调用中转。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] pi Model 格式与 compat、上下文校验、三协议 L3 fetch；按规格区分看门狗、中止和网络错误。
- [ ] 用 L1 假模型覆盖工具循环中的取消。
- [ ] 真实路径：让设置页和 smoke 入口共享文本适配器的连接测试入口及同一份非秘密 smoke 配置（协议、端点路径、模型名及参数）；由适配器生成固定探测输入。主线付费执行者在本任务合入前绕过 UI，以 `NL_REPLAY=record`、`NL_CASSETTE_DIR=tests/fixtures/text-models/smoke/` 录制三种协议的最小成功样例，计入 M0 预算并提交脱敏 cassette 和配置。离线 Check 显式使用 `tests/fixtures/text-models/synthetic/`；其他会话只跑严格回放，在 Progress 登记录制请求。
