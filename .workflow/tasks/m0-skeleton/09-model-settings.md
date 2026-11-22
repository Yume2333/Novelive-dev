# 09: 接线设置页和崩溃横幅

**Effort:** m0-skeleton
**Blocked by:** 04, 05, 07, 08
**Covers:** W2, W5
**Files:** packages/ui/src/pages/settings/, packages/ui/src/shell/, packages/creator/src/entry.ts, tests/e2e/m0-settings.spec.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M0 settings'` → 真实窗口保存设置、显示各模型测试结果、缩略图、取消和重启状态。

- [ ] 按原型完成五槽、界面/工程/关于与警告横幅；配置损坏可备份重置。
- [ ] 接入模型命令、宿主事件、错误映射和测试状态。
