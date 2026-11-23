# 08: 渲染作品的自定义文本标记

**Effort:** m3-playback
**Blocked by:** None
**Covers:** W1
**Files:** packages/creator/src/contract/production.ts, packages/creator/src/project/player.ts, packages/player/src/, packages/ui/src/pages/{player,editor}/, tests/, .workflow/evidence/m3-playback/
**Read first:** PR #61 的 `editor.resolveMark`、PR #53 的 M3/03 双层文本渲染、`docs/work-format.md` 的自定义样式。
**Check:** `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 custom marks'` → 真实 Electron 的播放和舞台预览显示整段与逐字样式，截图保存至 `.workflow/evidence/m3-playback/`。
**Base commit:** 91203f8c20e35a5527223e0fb814650c63ef3294

- [x] 将作品设置中的自定义标记传给播放和舞台预览；逐字模式按字素应用。
- [x] CSS 只作用于标记范围，不执行选择器、规则或加载外部资源；保持双层文本的测量和揭示行为。
- [x] 在严格回放的真实 Electron 中验收并保存截图。

## Progress

- Check after: `1 passed (2.9s)`。真实 Electron 接受提议、保存带标记的台词，并在[舞台预览](../../evidence/m3-playback/08-custom-mark-preview.png)和[播放](../../evidence/m3-playback/08-custom-mark-playback.png)显示逐字发光及整段下划线，未发起模型调用。
- 标记只接受文本样式白名单内的 CSS 声明，经 CSSOM 分别设置在测量层、显示层的对应节点。不注入样式表，不接受选择器、关键帧或资源引用，也不更改 Electron 沙箱和安全策略。
- Review: skipped — 此实现会话没有独立工作流审查代理；独立审查交由 PR 流程。
