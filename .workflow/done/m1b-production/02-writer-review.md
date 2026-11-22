# 02: 实现写手、审稿及演出脚本

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2, W3
**Files:** packages/creator/src/pipeline/writing/, tests/fixtures/cassettes/m1b-writer/, tests/unit/m1b-writer.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-writer.test.ts` → 源文检查、修订、分段、优先章衔接与脚本诊断通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** e7cfb4807edabffe81fe901a7da3aa8bb2624f93

- [x] 忠实默认开且核验真实引文、文风可选，每次只修一轮；覆盖改编/演出密度、红线和源段范围。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-writer.test.ts` — 25 项通过；完整 `pnpm check` 315 项通过。[凭据及 PR #27 审查修复](../../evidence/m1b-production/02-writer-review.txt)
- Real path: Electron 导入、播放器和确认界面 6 项通过；确认界面使用投影夹具。真实导入到两次确认的串接缺创作端调度命令，由 M1b/09 验证；本任务未宣称 W2/W3 整体验收。
- 合成短文录制已提交；4 次成功计量 4,181 tokens，1 次无计量 404 保留上界 16,384 tokens，合计按 20,565 tokens 记账，0 图片。
- Review: skipped — 无可启动的独立审查代理或隔离会话，按降级规则由 flow-close 补审。
