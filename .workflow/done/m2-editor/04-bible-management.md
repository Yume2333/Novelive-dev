# 04: 实现设定集和术语候选管理

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/creator/src/bible/editing/, packages/ui/src/pages/bible/, tests/e2e/m2-bible.spec.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 bible and glossary'` → 真实界面查看和接受/拒绝候选，不覆盖已确认内容。
**Base commit:** 0bf76ad045f9180ed1683ab7a372974519b557e4

- [x] 显示跨章节定位和冲突；对候选应用后传播约定的过期标记。

## Progress

- Implemented: 复用 readBible、现有 proposal/asset 表；版本冲突不写入，拒绝理由持久化；开放条目提供跨章原文段落定位；页面按分类查看并处理候选。
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 bible and glossary'` → 1 passed (2.9s)，真实 Electron 验证查看、接受、拒绝、过期不覆盖及图片过期映射，截图已检查；`pnpm typecheck` exit 0；`NL_REPLAY=strict pnpm check` → 23 files / 337 tests passed。
- Evidence: `.workflow/evidence/m2-editor/04-bible-management.txt`、`04-typecheck.txt`、`04-bible-before.png`、`04-bible-after.png`。
- Integration: M2/03 可调用 applyBibleProposal；entry.ts 仅增加必要 imports 与三条注册，不改共用契约或数据库结构。界面默认卷 v0001，可显式输入卷 ID 或使用 volume 查询参数。
- Review: skipped — 无可用的独立 reviewer/subagent 启动工具，留待里程碑关闭复核。
- PR #35 Check after: 修复卷 ID 逐字输入失焦、术语批准错误图片/风格提示，并在 AppShell.tsx 的 workNavigation 单行补设定集入口；真实 Electron 新断言通过（1 passed / 2.5s），`NL_REPLAY=strict pnpm check` → 23 files / 337 tests passed；截图及说明更新于原 evidence 路径。
