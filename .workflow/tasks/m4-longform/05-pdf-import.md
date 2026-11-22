# 05: 实现可提取文字的 PDF 导入

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/pdf/, tests/fixtures/source/pdf/, tests/unit/m4-pdf.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-pdf.test.ts` → 可选文字 PDF 生成章节；图像型扫描 PDF 明确提示不可导入。

- [ ] 不引入 OCR，按文档保留正文及分页合并语义。
