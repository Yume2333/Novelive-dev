# 01: 冻结作品包、版本及桌面接口

**Effort:** m5-delivery
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/format/src/package/contract.ts, packages/format/package.json, packages/creator/src/contract/share.ts, packages/creator/src/contract/index.ts, packages/player/src/contract/progress.ts, pnpm-lock.yaml, tests/unit/m5-package-contract.test.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m5-package-contract.test.ts` → 身份、版本、包条目及宿主载荷契约测试通过。
**Base commit:** c9fda5e5c38a59b4709bdd277998f72605c40f3a
**Status:** paused

- [x] 冻结 exports/import operation 与存档迁移形状；先引入文档指定 ZIP 依赖。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m5-package-contract.test.ts` → Test Files 1 passed (1), Tests 18 passed (18)；严格回放 `pnpm check` → Test Files 57 passed (57), Tests 727 passed | 1 skipped (728)。
- 实际调用包契约函数及宿主载荷校验器；ZIP 编解码、存档迁移执行和 Electron 接线分别由后续任务验收，本任务未运行付费测试。
- Review: skipped — 当前会话不能启动独立 workflow-reviewer 或 security-reviewer；合入前待审查，未归档。
