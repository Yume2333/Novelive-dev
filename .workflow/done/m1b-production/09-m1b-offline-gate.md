# 09: 严格回放演练真实应用贯通

**Effort:** m1b-production
**Blocked by:** 02, 03, 04, 05, 06, 07, 08
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/ui/src/App.tsx, apps/desktop/src/main/, tests/e2e/m1b-gate.spec.ts, .workflow/evidence/m1b/offline/
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b make and play'` → 从 TXT 导入到两次确认、第一章试玩和第二章发布在真实 Electron 通过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** e297472b1cc3e4460b159c6637863efbfb8d1798

- [x] 接线各路径和休眠阻止器，比较原型并截图；测试占位、暂停、重试和运行记录，不用真实模型。

## Progress

- Check after: `NL_REPLAY=strict pnpm test:e2e --grep 'M1b make and play'` → `1 passed (20.1s)`；`NL_REPLAY=strict pnpm check` → `Tests  333 passed (333)`。
- Real path: Electron 导入 TXT → 确认角色和主视觉 → 停止并恢复 → 第一章发布并试玩 → 确认继续 → 重试第二章 → 占位发布；SQLite 确认第二章未提前发布。截图和使用量见 [receipt](../../evidence/m1b/offline/receipt.txt)。
- Review: skipped — no fresh independent reviewer available.
