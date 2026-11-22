# 06: 接通 TXT 导入核对向导

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W1
**Files:** packages/ui/src/pages/import/, packages/creator/src/import/wizard/, tests/e2e/m1b-wizard.spec.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b TXT wizard'` → 用实际选择文件和工程目录流程导入、修订划分及跳过。

- [ ] 涵盖编码歧义、整理建议、分卷可编辑及参考图，读取 M1a 报告。
