# 08: 接通图片三项能力测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/image/, tests/unit/m0-image.test.ts, tests/fixtures/image-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-image.test.ts` → 用 03 的回放层接入合成 cassette 和故障注入，覆盖三项能力、故障映射、透明度及五档尺寸；不调用中转。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 适配 OpenAI 和 Seedream 的尺寸/质量/错误，并生成可经资源协议读取的缩略图。
- [ ] 404 编辑、400 尺寸、无 alpha 与 Seedream 参数错误用严格回放。
- [ ] 真实路径：用本任务的图片适配器（不依赖 09 的界面）跑文生图、透明底和编辑各一个成功样例。由主线付费执行者在本任务合入前以 `NL_REPLAY=record` 录制，计入 M0 预算并提交脱敏 smoke cassette 到 `tests/fixtures/image-models/smoke/`；其他会话只跑严格回放，在 Progress 登记录制请求。
