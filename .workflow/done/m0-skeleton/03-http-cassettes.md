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
- Review: pass (base a156b754a33242e59b00c194898964c99419cec0, reviewer Devin Review) — [PR #4](https://github.com/Yume2333/Novelive-dev/pull/4) 独立审查通过。
- PR #4 审查修复: 中转地址在 JSON 转义和 URL 编码时同样脱敏；仅在完整终止事件后保留取消读取的 SSE；坏图故障保留 JSON 外层、只改图片载荷。[复查日志](../../evidence/m0-skeleton/03-replay-review-check.txt) · [本地 HTTP 复验](../../evidence/m0-skeleton/03-replay-review-real-path.txt)
