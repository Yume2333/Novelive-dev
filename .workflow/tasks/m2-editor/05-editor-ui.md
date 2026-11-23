# 05: 实现编辑器、原文对照与舞台预览

**Effort:** m2-editor
**Status:** paused
**Base commit:** 0bf76ad
**Blocked by:** 01, 02
**Covers:** W1, W3
**Files:** packages/ui/src/pages/editor/, tests/e2e/m2-editor.spec.ts, packages/creator/src/entry.ts (editor.* 注册)
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor preview'` → 真实界面在固定工程定位原文和当前句，编辑、撤销及预览。

- [ ] 复用播放器，在 CodeMirror 实现文本效果和快捷位置，展示差异列表与标记提议横幅。

## Progress

- Plan amended: entry.ts 尚无 editor.* 处理器；08 集成晚于 05 自身 Check。所有者授权先按 01 契约实现界面，待 02 落 origin/main 后复用其实现注册命令，不另建持久化。
- 已实现 CodeMirror 6 单句保存、文本效果/自定义标记、快捷位置、原文按场景双向定位、会话撤销、复用最小播放器从当前句继续、重写差异勾选及标记接受/拒绝横幅。
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 editor preview'` → `1 failed`，真实入口已打开编辑器标题，因未注册 editor.open 无剧本控件；未以 mock 通过代替真实 Check。
- `pnpm typecheck`、`pnpm lint` 退出 0；`NL_REPLAY=strict pnpm test` → `Test Files 23 passed (23)`、`Tests 337 passed (337)`。
- Electron 组件契约回放 + 原有路由：`5 passed (10.4s)`；覆盖编辑/撤销/当前句预览、原文双向定位、效果插入、标记接受/拒绝、仅应用勾选差异、空章、打开失败及过期保存保留草稿。最后样式修正后复核 normal：`1 passed (6.5s)`。
- Review: skipped — 当前宿主未提供独立审查子代理工具。
- 凭据：[05-editor-ui.txt](../../evidence/m2-editor/05-editor-ui.txt)、[组件截图](../../evidence/m2-editor/05-editor-contract-fixture.png)。截图为契约替身下的真实编辑器组件，不是后端验收。
- 暂停于 `devin/1795394948-m2-editor-05`，worktree `.workflow/worktrees/m2-editor-05`。最后 fetch 的 origin/main 为 `0bf76ad`，无 `packages/creator/src/editor/history/`。02 合并后先同步 main，再在 entry.ts 注册 editor.*，复用每个 work 的 ProjectEditor 实例及 listHistory/saveRules；随后运行完整 Check。尚未归档或勾选完成。
