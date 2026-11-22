# 12: 录制设置页所需的最小图片 smoke

**Effort:** m0-skeleton
**Blocked by:** 08
**Covers:** W2, W4
**Executor:** spine (paid calls)
**Files:** tests/fixtures/image-models/smoke.ts, tests/fixtures/image-models/smoke-config.ts, tests/fixtures/image-models/smoke/, .workflow/evidence/m0-skeleton/12-image-smoke-check.txt
**Read first:** [08 归档](../../done/m0-skeleton/08-image-models.md)、[M0 规格](../../specs/m0-skeleton.md)、[用量计划](../../delivery-plan.md#测试模型与额度)。
**Check:** 仅串行主线执行 `NL_REPLAY=record NL_CASSETTE_DIR=tests/fixtures/image-models/smoke/ pnpm exec tsx tests/fixtures/image-models/smoke.ts`，然后用同目录及同测试入口以 `NL_REPLAY=strict` 离线 replay；并行会话不领取本任务，纯合成回放不能替代录制。

- [ ] 用开发中转的 `gpt-image-2.6-sunburst` 记录文生图、透明底、编辑各一个成功样例，调用写入私有 `usage.csv`，计入 M0 用量。只提交脱敏 cassette 和非秘密 smoke 配置；真实调用失败或缺档在 Progress 写明，不标为完成。
- [ ] 录制与 09 共用 08 的 `testImage` 和固定测试输入，回放可替换主机和凭据，保持 method、path 和 canonicalBody 一致。记录严格回放证据后再解锁 09；08 归档中的额外供应商样例不阻塞这组开发中转 smoke。
