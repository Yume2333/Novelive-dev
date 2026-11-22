# 03: 实现 HTTP 录制与严格回放

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W2, W3, W4
**Files:** packages/creator/src/replay/, tests/unit/m0-replay.test.ts, tests/fixtures/replay/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm exec vitest run tests/unit/m0-replay.test.ts` → 三个模式、脱敏、外置响应体、strict 缺档及故障注入通过。
**Base commit:** a156b754a33242e59b00c194898964c99419cec0

- [x] 按规格定义 JSONL、稳定请求键、白名单头与大响应体 sha 外置；注入 midcut/disconnect/cancel/http500/bad-image/delayMs。
- [x] 发布给 07/08 共用的 fetch 注入接口；本任务只用合成数据，不用 relay。

## Progress

- Check before: 基线 a156b75 没有回放模块或该测试文件。
- Check after: `pnpm exec vitest run tests/unit/m0-replay.test.ts`：4 个测试通过，类型检查通过。[检查日志](../../evidence/m0-skeleton/03-replay-check.txt)
- Real path: 用原生 fetch 读取合成数据并落盘，然后从磁盘严格回放；缺档不调用上游。[实际运行输出](../../evidence/m0-skeleton/03-replay-real-path.txt)
- Review: skipped — 当前会话无法启动独立工作流与安全审查员，留待 PR 审查。
