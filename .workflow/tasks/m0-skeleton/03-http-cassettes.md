# 03: 实现 HTTP 录制与严格回放

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W2, W3, W4
**Files:** packages/creator/src/replay/, tests/unit/m0-replay.test.ts, tests/fixtures/replay/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm exec vitest run tests/unit/m0-replay.test.ts` → 三个模式、脱敏、外置响应体、strict 缺档及故障注入通过。

- [ ] 按规格定义 JSONL、稳定请求键、白名单头与大响应体 sha 外置；注入 midcut/disconnect/cancel/http500/bad-image/delayMs。
- [ ] 发布给 07/08 共用的 fetch 注入接口；本任务只用合成数据，不用 relay。
