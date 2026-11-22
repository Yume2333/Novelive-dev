# 02: 实现 EPUB 导入及插图候选

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/epub/, tests/fixtures/source/epub/, tests/unit/m4-epub.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-epub.test.ts` → nav、NCX、标题和 spine 层级逐级回退，图片定位及视觉分类可回放。

- [ ] 提取章节和插图，排除私有数据；以已有研究片段为参照，保留手选候选。
