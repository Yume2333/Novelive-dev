# 04: 实现 DOCX 导入

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/docx/, tests/fixtures/source/docx/, tests/unit/m4-docx.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-docx.test.ts` → 标题、段落和注脚正确归档，坏文件给出错误。

- [ ] 用合成文档验证，维护共享导入输出形状。
