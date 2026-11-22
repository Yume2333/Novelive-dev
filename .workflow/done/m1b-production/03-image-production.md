# 03: 实现美术导演与图片制作

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W1, W2, W3
**Files:** packages/creator/src/pipeline/art/, tests/fixtures/cassettes/m1b-art/, tests/unit/m1b-art.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-art.test.ts` → 三类素材及主视觉/候选、PNG 透明、WebP、技术及视觉检查、失败映射通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** f1a0090eba860b4f86937b57b09c7ab9f246b4ac

- [x] 按规格关联画风、造型和地点参考；区分基准/派生，合并同义表情；注册素材、跳过已有文件、技术与视觉审核、失败放三类占位。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-art.test.ts` 通过 5 项；`NL_REPLAY=strict pnpm check` 通过 217 项。
- Real path: 严格回放的 CLI 调用实际 SQLite 工程及出图入口，确认三张主视觉和三套造型候选，制作六张素材并重新打开工程；验证四次普通失败使用占位，能力不支持保持待画。不是 Electron 里程碑验收。
- Evidence: [离线检查与实际工程运行](../../evidence/m1b-production/03-image-production.txt)。
- 真实录制（仅协调者，未调用）：03 的离线 Check 使用合成 cassette，不需付费。请串行主线会话 `devin-dcaabd625b594dd5be327904cea387e6` 在 W1–W3/10 验收时按预算录制主视觉候选、带画风参考的透明立绘及表情编辑、带造型和地点基准的 CG、视觉审核结构化结果；私有录制不提交。
- Review: skipped — 当前子代理未提供独立审查工具；PR 须通过 Devin Review 后合并。
