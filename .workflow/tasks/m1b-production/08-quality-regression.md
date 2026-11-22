# 08: 建立可回放的质量评测集

**Effort:** m1b-production
**Blocked by:** 02
**Covers:** W3
**Files:** tools/quality/, tests/fixtures/quality/, .workflow/evidence/m1b/quality/, tests/unit/m1b-quality.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-quality.test.ts` → 离线评测产出结构化评分与失败分类，可重跑。

- [ ] 按 handoff 做评分、机械检查和独立 judge；仓库只存自编或可分发标注，不存私有原文。
