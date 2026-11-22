# 06: 贯通 TXT 导入到磁盘工程

**Effort:** m1a-project
**Blocked by:** 02, 03, 05
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/creator/src/project-pipeline/, tests/integration/m1a-project.test.ts, .workflow/evidence/m1a/offline/
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m1a-project.test.ts` → 真实工程 API 使用合成多卷原文完成导入、预览与综合，磁盘及重开检查通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** 32ac7a7ed5c26ff485085e002d3430cfe9ad2539

- [x] 串接每一模块并验证报表和工程；固定 M1b 可调用的输入/输出。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m1a-project.test.ts` — 1 项通过；完整 `pnpm check` 288 项通过，含 TXT 边界和剧本编译测试。
- Real path: 独立 CLI 进程导入合成两卷三章，首跑回放 7 次，重开 0 次；确认设定未被候选冲突覆盖。工程 schema 的独立重开保留排队任务及 SQLite 完整性。[凭据](../../evidence/m1a/offline/receipt.txt)
- M1b 从 `packages/creator/src/project-pipeline` 调用 `prepareVolume(project, volumeId, options)`，从磁盘读取序列、工作及正文，返回 `previews`、`digests` 和 `synthesis`。导入本身不触发模型。无付费调用；不覆盖 W4 真书验收。
- Review: skipped — 无可启动的独立审查代理或隔离会话，按降级规则由 flow-close 补审。
