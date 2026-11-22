# 07: 接通文本和视觉模型测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/text/, tests/unit/m0-text.test.ts, tests/fixtures/text-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict NL_CASSETTE_DIR=tests/fixtures/text-models/synthetic/ pnpm exec vitest run tests/unit/m0-text.test.ts` → 用 03 的回放层接入合成 cassette 和故障注入，覆盖三种协议及带图视觉测试的成功、错误、重试、取消；不调用中转。
**Base commit:** cdfc64d9cf2155ee37cd665e2e10d899c9826b37

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [x] pi Model 格式与 compat、上下文校验、三协议 L3 fetch；按规格区分看门狗、中止和网络错误。
- [x] 用 L1 假模型覆盖工具循环中的取消。
- [x] 真实路径：提供供设置页复用的文本适配器连接测试入口与非秘密 smoke 配置，由适配器生成固定探测输入。主线绕过 UI，录制三种协议的最小成功样例到 `tests/fixtures/text-models/smoke/`，再以相同请求在无中转凭据时严格回放。

## Progress

- Check before: `cdfc64d` 没有文本适配器或 M0/07 单测。
- Check after: 三种 SDK 协议、带图请求、错误、两层重试和工具中止等 17 项通过。[检查日志](../../evidence/m0-skeleton/07-text-check.txt)
- Real path: 真实中转各一次 Chat（带图）、Responses、Messages，脱敏后离线严格回放全过。共 1,694 tokens、0 张生成图片，三条调用已写入私有账本。[录制及回放凭据](../../evidence/m0-skeleton/07-text-real-path.txt)
- Review: skipped — 当前会话未进行独立审查；设置接线及 UI 真实验收留给 09。
