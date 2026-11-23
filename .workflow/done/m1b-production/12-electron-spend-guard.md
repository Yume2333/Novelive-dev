# 12: 防止 Electron 真书制作超预算

**Effort:** m1b-production
**Blocked by:** 09, 10
**Covers:** W4
**Files:** `packages/creator/src/{usage,replay,project,pipeline,models,scheduler}/`、`.workflow/owner-review.md`
**Read first:** M1b/11、[共享额度](../../delivery-plan.md#测试模型与额度)和[账本对账](../../owner-review.md#付费账本对账)
**Check:** `NL_REPLAY=strict pnpm test tests/unit/m1b-spend.test.ts tests/unit/m1b-production-worker.test.ts tests/unit/m1a-owner-book-usage.test.ts tests/unit/m0-replay.test.ts tests/unit/m4-epub.test.ts` → 超额的后台预处理、文字、视觉和图片请求均不触达传输端；另以 `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M1b make and play'` 验证无网络制作流程。
**Base commit:** f9dd863b5eaa867e6c9037606fe2d7840f1bec05

- [x] 真书用全新私有工程。启动 Electron 前设置 `NL_RUN_TOKEN_CAP` 和 `NL_RUN_IMAGE_CAP`（非负整数）；未配置不发制作请求。每个工程的 SQLite 数据库持久保留已核销和未核销用量，暂停、重启或重试不重置预算。严格回放命中不扣账。
- [x] 输出上限和输入预留适用于当前模型协议；视觉输入中内联媒体按传输字节预留。生图每张另预留 `NL_RUN_IMAGE_TOKEN_RESERVE`（默认 100,000 tokens，须按中转模型的上界校验）。只在返回可信用量时核销对应维度；未核销不能当作余额释放。此检查无法限制不遵守请求上限的中转，使用前确认模型与中转的计价及上界。
- [x] 只做离线验收；本任务不替代 M1b/11 真书检查，不改变 M1a W4 的 0.90 门槛。

## Progress

- Check after: 专项测试 `Test Files  5 passed (5)`、`Tests  86 passed | 1 skipped (87)`；Electron 严格回放跨过两次确认，`1 passed (21.6s)`。后台预处理被拒时，传输端调用为零，也不写入录制 CSV。见[离线回执](../../evidence/m1b/electron-spend-guard.txt)。
- Review: skipped — 当前会话不能启动独立审查 agent。
