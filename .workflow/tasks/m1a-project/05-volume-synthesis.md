# 05: 按卷综合及候选冲突处理

**Effort:** m1a-project
**Blocked by:** 04
**Covers:** W3, W4
**Files:** packages/creator/src/synthesis/, tests/fixtures/cassettes/m1a-synthesis/, tests/unit/m1a-synthesis.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-synthesis.test.ts` → 整卷和分块的严格回放均可生成文件，断点续跑、不覆盖冲突。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 维护结构化骨架与 BiblePatch；采用已有资料的逐事件提取策略与硬停止，预留选书对照，不用合成样例替代对照。
