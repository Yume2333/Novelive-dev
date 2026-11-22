# 04: 交付分享和版本更新 UI

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/ui/src/pages/library/share/, packages/ui/src/pages/work/share/, packages/ui/src/pages/player/controls/legacy-saves/, tests/e2e/m5-share-ui.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 share surfaces'` → 真实界面可选择范围/原文、审核警告、确认更新和导入为工程。

- [ ] 新增导入和更新提示及旧版存档组；完工后接共享入口。
