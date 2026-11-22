# 03: 实现 Markdown 导入

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/markdown/, tests/fixtures/source/markdown/, tests/unit/m4-markdown.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-markdown.test.ts` → 标题、分卷、段落及非正文正确归档。

- [ ] 解析实际合成 Markdown 文件，不要求模型识别文本边界。
