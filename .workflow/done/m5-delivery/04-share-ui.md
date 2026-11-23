# 04: 交付分享和版本更新 UI

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/ui/src/pages/library/share/, packages/ui/src/pages/work/share/, packages/ui/src/pages/player/controls/legacy-saves/, tests/e2e/m5-share-ui.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 share surfaces'` → 真实界面可选择范围/原文、审核警告、确认更新和导入为工程。
**Base commit:** e10725ed62a8c41308a373b35d1a7fc6d92aa5cb

- [x] 新增导入和更新提示及旧版存档组；复用冻结的分享请求与存档分组契约。

## Progress

- Check after: `NL_REPLAY=strict xvfb-run -a pnpm exec playwright test --grep 'M5 share surfaces'` 使用构建后的 Electron 界面，1 passed。
- 真实作品包接线留给 M5/07：导出处理器在包写入成功后持久化 codec 返回的版本，再向界面返回成功；取消或失败不更新版本。旧存档读取和删除接入 M5/03 产出的存储。
- Review: skipped — 本任务执行会话没有独立审查子代理；随 PR 和 M5 集成审查。
