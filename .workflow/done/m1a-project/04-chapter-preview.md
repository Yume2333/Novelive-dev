# 04: 全书预览与卷摘要

**Effort:** m1a-project
**Blocked by:** 01
**Covers:** W3
**Files:** packages/creator/src/preview/, tests/fixtures/cassettes/m1a-preview/, tests/unit/m1a-preview.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-preview.test.ts` → 严格回放覆盖拆段、不截断、汇总与重启恢复。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** aafdadd254a04a306f2e8d253df91cc3fc2d6554

- [x] 每章读完，按卷生成 digest，并保留人物、地点、时间线和伏笔。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-preview.test.ts` — 7 项通过，覆盖整章拆段、超长单段和 Unicode 无截断、逐卷事实保留、断开重开恢复、空输入、取消、严格缺档、schema 修复与输出截断拒绝。[凭据](../../evidence/m1a/04-preview-check.txt)
- Real path: 独立 CLI 进程创建实际 SQLite 工程并调用 `previewBook`，生成 3 章预览和 2 卷 digest；另一进程重开，模型调用 0 次。[凭据](../../evidence/m1a/04-preview-real-path.txt)
- 验证：TypeScript 通过；lint 退出 0（仅既有 `text-models/build-synthetic.ts` 的 useTemplate 提示）；复用层回归 41 项通过。凭据：`04-preview-typecheck.txt`、`04-preview-lint.txt`、`04-preview-regression.txt`（同证据目录）。
- Cassette：沿用 M0 `text-models/synthetic` 和 moderation 的合成回放先例，已提交纯合成文本与本地 SSE，不是真实模型录制；未绑定秘密、未付费调用。真实模型质量与真书验收未做，不替代 W4。
- 接口：直接接收按序章段落，不实现 TXT 导入；使用已有模型、严格回放和原子工程写入。逐章文件是恢复点；卷摘要保留各章事实列表，摘要过长时分组拼接，和 VolumeSkeleton 分离。
- Review: skipped — 当前工具目录没有独立审查代理或隔离会话启动工具；按降级规则由 flow-close 补审，未自审通过。
