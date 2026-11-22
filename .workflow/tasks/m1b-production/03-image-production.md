# 03: 实现美术导演与图片制作

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W1, W2, W3
**Files:** packages/creator/src/pipeline/art/, tests/fixtures/cassettes/m1b-art/, tests/unit/m1b-art.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-art.test.ts` → 三类素材及主视觉/候选、PNG 透明、WebP、技术及视觉检查、失败映射通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 按规格关联画风、造型和地点参考；区分基准/派生，合并同义表情；注册素材、跳过已有文件、技术与视觉审核、失败放三类占位。
