# 04: 实现 DOCX 导入

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/docx/, tests/fixtures/source/docx/, tests/unit/m4-docx.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-docx.test.ts` → 标题、段落和注脚正确归档，坏文件给出错误。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff

- [x] 用合成文档验证，维护共享导入输出形状。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-docx.test.ts` → 1 file passed, 27 tests passed；包含本地合成 DOCX 文件经 `importDocx(sourcePath)` 的实际入口运行。[验收凭据](../../evidence/m4-longform/04-docx-check.txt)。
- Review: skipped — [#46 的独立 Devin Review](https://app.devin.ai/review/yume2333/novelive-dev/pull/46) 记录的十项发现均已修复；本次归档未改 DOCX 代码，未对合入后的实现另行发起独立复审。
- 复用 zip.js / saxes；单标题层级作为章，多层级最浅作为卷；按 Word 段落调用 TXT 净化分类，分类前遮蔽对白中的网址（非整段网址），正文保留原字面值；长章使用 TXT 的长度上限。空章省略，纯附注章附注保留到相邻有正文的章。
- [#66 的真实 Electron W1 验收](../../evidence/m4-longform/gate-resume.txt)覆盖通过向导导入 DOCX；已支持手选内嵌插图，图片不混入正文。
