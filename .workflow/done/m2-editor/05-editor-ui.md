# 05: 实现编辑器、原文对照与舞台预览

**Effort:** m2-editor
**Base commit:** 0bf76ad
**Blocked by:** 01, 02
**Covers:** W1, W3
**Files:** packages/ui/src/pages/editor/, tests/e2e/m2-editor.spec.ts, packages/creator/src/entry.ts (editor.* 注册)
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor preview'` → 真实界面在固定工程定位原文和当前句，编辑、撤销及预览。

- [x] 复用播放器，在 CodeMirror 实现文本效果和快捷位置，展示差异列表与标记提议横幅。

## Progress

- Plan amended: entry.ts 原无 editor.* 处理器；08 集成晚于 05 自身 Check。所有者授权增加 02 依赖及 entry.ts 注册范围；已合并 origin/main `5ea3d49`，复用 02，不另建持久化。
- 已实现 CodeMirror 6 单句保存、文本效果/自定义标记、快捷位置、原文按场景双向定位、会话撤销、复用最小播放器从当前句继续、重写差异勾选及标记接受/拒绝横幅。
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 editor preview'` → `1 passed (2.1s)`；真实工程原文/当前句定位、保存、撤销、预览、重新打开后会话撤销清空，且验证历史/规则 IPC、缓存背景像素及待绘素材失败提示。凭据见 [05-editor-ui.txt](../../evidence/m2-editor/05-editor-ui.txt)。
- `pnpm typecheck`、`pnpm lint` 退出 0（lint 仅有原有 useTemplate info）；`NL_REPLAY=strict pnpm test` → `Test Files 25 passed (25)`、`Tests 351 passed (351)`，含 02 历史及 03 会话测试。
- Electron 组件契约回放 + main 原有 M2 路由：`5 passed (12.2s)`；覆盖效果插入、标记接受/拒绝、仅应用勾选差异、空章、打开失败及过期保存保留草稿。
- entry.ts 每 work 复用 ProjectEditor，注册 open/close/editLine/undo/history/saveRules；打开工程不启动生产队列或模型服务。editor.open 在入口把工程素材复制到宿主缓存，返回内容寻址路径；待绘/缺失素材返回不可用缓存路径，不把工程路径交给资源协议。
- 02/main 尚无 resolveMark、rewriteScene、applyRewrite、regenerateImage、selectImage 实现，均未注册替身；05 的 Check 不需要这些命令。标记/重写成功路径仅有组件契约覆盖，真实后端交互仍待对应实现。
- Review: skipped — 当前宿主未提供独立审查子代理工具。
- 凭据：[05-editor-ui.txt](../../evidence/m2-editor/05-editor-ui.txt)、[真实工程截图](../../evidence/m2-editor/05-editor-preview.png)、[组件截图](../../evidence/m2-editor/05-editor-contract-fixture.png)。已查看真实工程预览截图；组件截图仍明确为契约替身。
