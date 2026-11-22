# 03: 实现 TXT 抽取与核对报告

**Effort:** m1a-project
**Blocked by:** 01
**Covers:** W2, W3
**Files:** packages/creator/src/import/txt/, tests/fixtures/source/txt/, tests/unit/m1a-txt.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-txt.test.ts` → 六编码、模糊候选、异常卷/章、净化和段落 ID 均通过。

- [ ] 遵守识别顺序和最大章长度，不引入 chardet；源文、纯正文、附注及导入核对结果保存到已约定路径。
