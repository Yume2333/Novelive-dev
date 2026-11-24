# 04: 实现持久存档、已读与回滚

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W2
**Files:** packages/player/src/progress/, apps/desktop/src/save-data/, tests/integration/m3-save.test.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-save.test.ts` → 应用数据目录存档可重开，60+1 槽、200 条快照及主线/重看语义正确。

- [x] 含 WebP 缩略图、跨章回滚和 forward 指针，方案按手册保存未结束演出并按类型恢复。

## Progress

- 基于 origin/main 的 M3/01 契约（f08f8b7），分支 `devin/1795402999-m3-04-save-history`；只改本任务 Files 与本节。
- `PlaybackProgress`：200 条完整状态快照、跨章 jump/rollback/forward、分岔截断、已读集合和只向前的主线；目录重看不推进主线。宿主传入句子顺序比较器，不把不透明 ID 当章节/句子顺序。
- `captureSnapshot` 保留活动演出；`restoreSnapshot` 先恢复状态，只重跑 replay-state，跳过 skip-relative，文本只从第 1 页重建一次。沿用 M3/01 的分类，不重跑整句。
- `FileProgressStore`：`app.getPath('userData')/player-progress/<workId 的 SHA-256>/`，JSON 原子替换、写入串行；60 普通槽 + 1 快存槽。舞台截图由宿主传入，sharp 编码为 480×270 WebP，内容寻址缩略图不随槽位覆盖破坏旧快照。
- 接入点：桌面主进程调用 `createDesktopProgressStore()`；播放器使用 `PlaybackProgress`，存槽后用 `putSave(entry)` 同步内存条目，再通过 ProgressStore 保存 `data`；舞台实现 SnapshotRenderer。当前 main 只有 minimal 播放器，未修改并行任务负责的舞台、菜单、IPC 或 UI；这些入口须由对应任务接入，不声称已验证菜单操作。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-save.test.ts` → `Test Files 1 passed (1)` / `Tests 10 passed (10)`；receipt: `.workflow/evidence/m3-playback/04-save-history-check.txt`。
- 回归：`NL_REPLAY=strict pnpm exec vitest run tests/unit/m3-contract.test.ts tests/unit/m1b-player.test.ts` → `Test Files 2 passed (2)` / `Tests 10 passed (10)`。
- `pnpm typecheck` → `tsc --noEmit` exit 0；`pnpm lint` → `Checked 252 files` / `Found 1 info.` exit 0（既有 build-synthetic.ts useTemplate 提示）。Node 24.22.3 / pnpm 12.21.0 通过 nvm 环境加载。
- Real path: 使用 xvfb-run -a 启动两次 Electron，真实调用 createDesktopProgressStore、保存、退出、重开、恢复与 WebP 解码：`Electron write: app.getPath(userData), snapshot and WebP saved`；`Electron reopen: quick slot restored at page 0; 480x270 WebP decoded`。无 API 请求，不需要 cassette。Electron 有 sharp 通用兼容性警告和无桌面 DBus 会话日志，sharp 安装补丁已应用且实际编码/解码通过；无 UI 改动，未做视觉验收。
- Review: pass (base f08f8b7, reviewer devin-review)
- PR #55 审查修复：已存在的内容哈希缩略图不重写；新图临时写入再 rename；槽位 JSON 成功提交后清理无引用 WebP。新增复用文件不变与共享引用/替换清理测试，证据文件为本次获准的 Files 范围外新增。
- 清理为 best-effort：readdir 或单个 unlink 失败不影响已提交的存档；新增真实 unlink 失败仍保存成功、其他孤立图片仍清理的测试。
- 复核（2026-11-24，nl-01 worktree，Node v24.22.3）：`NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-save.test.ts` → `Test Files 1 passed (1)` / `Tests 10 passed (10)`，当前 main 上存档集成检查仍通过。
- Review: blocked (independent reviewer, 2026-11-24, window 01) — 独立只读审查确认 60+1 槽、200 条快照、跨章回滚/forward、WebP 缩略图、原子写入与持久化重开断言均为实质覆盖；持久化快照经 `toEqual(frozen)` 验证与重载字节一致，真实播放器 replay-state 恢复另有 `packages/player/src/stage/player.test.ts` 覆盖。存活发现一条：「现场未结束演出按类型分类捕获」未被端到端验证——`captureSnapshot` 只克隆调用方传入的 `active`，生产端（`stage/index.ts:316`、`minimal/index.ts:325`）目前只发 `[{restore:'restart-text'}]`，测试中的 replay-state/skip-relative 条目均手工构造；即契约类型已实现并按类型 dispatch，但没有用例证明播放中产生的未结束效果会以对应类型进入快照。属测试覆盖度问题，非功能缺陷；已上报。
- 复核修复（2026-11-24）：实现真实分类捕获——`packages/player/src/stage/state.ts` 新增 `activePerformances(actions, stage)`：move/shake 与「重放会改变已存状态」的方向记 `skip-relative`，对已存状态幂等的意图型方向记 `replay-state`；文本拍快照时在 `stage/index.ts` 用它分类 `beat.actions`。修复暴露并解决了一个真实缺陷：序列方向（如 hide+show 换装）若全记 replay-state，恢复时 `direct` 重放会把立绘重置到槽位默认 x（e2e 实抓到 480 vs 期望 240）；只有对已存状态幂等的方向才可记 replay-state。新增 `player.test.ts`「captures the live unfinished performances…」用真实 mountMinimalPlayer 验证第一拍 [replay bg, replay show, restart-text]、第二拍 [skip-relative(move), restart-text]，恢复只重放 replay-state；`tests/e2e/m3-stage.spec.ts` 的动画中途存档断言同步更新为实分类结果（该 spec 在 baseline 上同样在第 258 行像素断言失败——像素收到变暗的立绘色，属环境性既有失败，与本次改动无关，baseline 复测同点失败已证实）。`NL_REPLAY=strict pnpm exec vitest run tests/ packages/` → 68 files / 1078 tests passed；`pnpm typecheck` exit 0。
- Review: pass (independent reviewer, 2026-11-24, window 01) — 同一审查者对修复后证据复核：真实播放器路径的 `activePerformances` 现场分类（含「对已存状态不幂等 → skip-relative」的防叠加判断）与恢复只重放 replay-state 的端到端断言成立，此前报出的分类覆盖缺口已闭合。无存活发现。
