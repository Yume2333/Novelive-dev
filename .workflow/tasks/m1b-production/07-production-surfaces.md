# 07: 移植创作界面与确认点

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/ui/src/pages/production/, packages/ui/src/pages/work/, packages/ui/src/pages/confirm/, packages/ui/src/pages/settings/production/, tests/e2e/m1b-creation-ui.spec.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b creation surfaces'` → 用合成投影显示制作状态、两次确认、失败再试和高级设置。
**Base commit:** f1a0090eba860b4f86937b57b09c7ab9f246b4ac
**Status:** active

- [ ] 连接第一卷角色、三份主视觉、已发布/需要处理、运行记录、写手及角色模型配置；UI 固定契约后独立。
