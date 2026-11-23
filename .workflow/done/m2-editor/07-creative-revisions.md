# 07: 接通重写场景、单图重画与重跑

**Effort:** m2-editor
**Blocked by:** 02, 03
**Covers:** W3
**Files:** packages/creator/src/editor/revisions/, tests/fixtures/cassettes/m2-revisions/, tests/unit/m2-revisions.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-revisions.test.ts` → 实际工程只应用勾选的重写，重画保留旧版本历史，重跑范围正确。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** 1749d9f97391363d08c31a7dc02401b35b3ca2b8

- [x] 复用写手、出图与综合管线。设置、重写、重图和重做章节都按输入版本在写前再次校验。

## Progress

- Implemented: `CreativeRevisions`（`packages/creator/src/editor/revisions/`）复用写手管线重写单个场景，按行 LCS 生成带稳定行号的差异块，提案落盘到 `source/production/rewrites/`，应用时只写勾选块并经 `ProjectEditor` 审计历史；单图重画复用 `ArtProduction.redraw` 先出候选，再采用并把旧图存入 `history/assets/`、写 `kind: image` 历史；重跑经调度器 `redoChapter` 只重排该章写作/审阅/演出，已画素材按名跳过。对话提议 `rewriteScene`/`redrawImage`/`redoChapter` 走同一后端。调度器仅把 `stale` 加入底图依赖门。`entry.ts` 未注册命令，留给 M2/08（构造 `CreativeRevisions`，worker 来自 `createProduction` 会话的 `rewriteScene`/`redraw`/`adoptImage`/`redo`）。
- Versions: 重写、应用、重画、采用、重跑都在写前比对章节或图片 revision；生产 worker 每步重新读取作品设置，规则只作用于之后开始的工作。
- Cassette: `tests/fixtures/cassettes/m2-revisions/` 为合成录制（作者脚本进程内应答，无付费调用）。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-revisions.test.ts` → 2 passed；真实路径 `run.ts` 在导入的 SQLite 工程上只应用 h2、重画与候选成功；`NL_REPLAY=strict pnpm check` → 29 files / 390 tests passed。Evidence: `.workflow/evidence/m2-editor/07-creative-revisions.txt`。
- Review: pass (base 1749d9f97391363d08c31a7dc02401b35b3ca2b8, reviewer Devin Review) — [PR #41](https://github.com/Yume2333/Novelive-dev/pull/41) 两轮：修复多场景章节重写的原文覆盖校验、确认点期间重跑卡住、重跑误解除失败暂停、确认立绘无绘制记录无法重画、重跑版本校验未加锁、替换行越过演出指令。M2/08 接线 `editor.regenerateImage` 时需像视觉确认一样把候选图复制到应用缓存再交给界面。
