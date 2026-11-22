# 10: 贯通扩展格式、队列与宿主

**Effort:** m4-longform
**Blocked by:** 02, 03, 04, 05, 06, 07, 08, 09
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/creator/src/import/wizard/, packages/ui/src/pages/import/, apps/desktop/src/main/index.ts, tests/e2e/m4-gate.spec.ts, .workflow/evidence/m4/
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 longform and queue'` → 从五种格式走真实导入，跨卷与跨作品生产，通知及恢复可观察。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 通过严格回放比较真实流程并截图；只有授权样本和预算可用时跑限定章节做跨语种/插图抽查。
