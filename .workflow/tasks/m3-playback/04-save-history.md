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
