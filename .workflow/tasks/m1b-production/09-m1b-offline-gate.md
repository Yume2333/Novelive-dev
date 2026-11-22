# 09: 严格回放演练真实应用贯通

**Effort:** m1b-production
**Blocked by:** 02, 03, 04, 05, 06, 07, 08
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/ui/src/App.tsx, apps/desktop/src/main/, tests/e2e/m1b-gate.spec.ts, .workflow/evidence/m1b/offline/
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b make and play'` → 从 TXT 导入到两次确认、第一章试玩和第二章发布在真实 Electron 通过。

- [ ] 接线各路径和休眠阻止器，比较原型并截图；测试占位、暂停、重试和运行记录，不用真实模型。
