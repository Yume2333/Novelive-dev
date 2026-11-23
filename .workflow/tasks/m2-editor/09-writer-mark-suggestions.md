# 09: 确认写手提议的自定义文本标记

**Effort:** m2-editor
**Blocked by:** None
**Base commit:** 84345daf87313a81be7d63a9e2f7e8b4f950a1c1
**Status:** active
**Covers:** W1
**Files:** packages/creator/src/pipeline/writing/, packages/creator/src/project/production-worker.ts, packages/creator/src/editor/, packages/ui/src/pages/editor/, tests/unit/, tests/e2e/m1b-gate.spec.ts, .workflow/evidence/m2-editor/
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/decisions.md` 的文本效果决策、`docs/creation-pipeline.md`、`docs/ux.md`。
**Check:** `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M1b make and play'` → 写手提议在真实 Electron 的编辑器横幅中显示，接受后可选用，拒绝后消失。

- [x] 写手可提议名称、CSS、逐字开关；未确认标记不进入剧本或作品设置。
- [x] 编辑器使用版本校验接受/拒绝提议，不新增聊天确认类型。
- [x] 在真实 Electron 严格回放验收；单次真实写手录制私有保存，公开证据只留截图和回执。

## Progress

- Check after: 严格回放 M1b gate、M2 editor、M2 gate，`11 passed (28.5s)`；`NL_REPLAY=strict pnpm check`，`45 passed (45)` 文件、`583 passed | 1 skipped (584)` 测试。
- 真实写手录制一次，严格重放零上游调用。用量和打开编辑器时的横幅截图见 [验收回执](../../evidence/m2-editor/09-writer-mark-suggestions.md)；独立审查在 PR 中完成。
