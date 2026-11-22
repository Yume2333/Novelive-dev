# 01: 冻结作品包、版本及桌面接口

**Effort:** m5-delivery
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/format/src/package/contract.ts, packages/format/package.json, packages/creator/src/contract/share.ts, pnpm-lock.yaml, tests/unit/m5-package-contract.test.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m5-package-contract.test.ts` → 身份、版本、包条目及宿主载荷契约测试通过。

- [ ] 冻结 exports/import operation 与存档迁移形状；先引入文档指定 ZIP 依赖。
