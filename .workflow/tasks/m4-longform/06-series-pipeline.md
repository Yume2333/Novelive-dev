# 06: 实现系列覆盖、多卷和跨语言

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/project/series/, packages/creator/src/synthesis/incremental/, packages/creator/src/pipeline/writing/locale/, packages/format/src/model/inheritance/, tests/integration/m4-series.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m4-series.test.ts` → 实际工程复用角色素材；下级同 ID 整条覆盖， join-series 不删既有条目。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff
**Status:** active

- [x] 续卷逐步综合、首卷不等后续卷、直接生成目标语言，使用术语表和原书一致的命名。

## Progress

Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m4-series.test.ts` → 1 file / 4 tests passed；最终含该文件及 art、production-worker 的受影响回归 → 3 files / 23 tests passed。证据：`.workflow/evidence/m4-longform/06-series-pipeline.txt`。
验证：既有 synthesis、writer、player、工程集成通过；art 旧断言的回归已修正为仅在下级 scope 跳过已绘制任务，art 与 production-worker 复验通过；`pnpm typecheck`、`pnpm lint` 成功。
真实服务路径：离线集成从磁盘工程调用 joinSeries、prepareSeries、productionBible、ArtProduction.register 与 writeChapter；没有使用付费接口，没有新增 cassette。Electron W2 整体验收尚未运行。
Review: skipped — 当前宿主未提供可创建独立审查 subagent 的工具；需协调者安排新上下文审查。
后续接线：02–05 导入协调者将提取章节交给 joinSeries；保留新的 `source/imports/<volumeId>/original.*`，不调用旧的空工程导入布局。向导接线按本次范围明确不做。
后续接线：07 在队列服务接入 prepareSeries 的 onReady，将当前卷立即交付制作；本任务不改 production.ts、scheduler/ 或导入器。目标语言沿用 work.language。
