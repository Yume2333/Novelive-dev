# 01: 冻结扩展导入与队列边界

**Effort:** m4-longform
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/creator/src/contract/import.ts, packages/creator/src/contract/queue.ts, packages/creator/package.json, pnpm-lock.yaml, tests/unit/m4-import-contract.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-import-contract.test.ts` → 四种提取器、卷链接以及制作状态与用量 payload 通过契约测试。
**Base commit:** 922e6538a69242d6ac29dc267755eb7f1c672e8e

- [x] 先用最小样件选择解析依赖；优先仓库研究片段、标准库和已装依赖，以编码、导航级联、格式元数据、许可和本地解析来验证新增依赖。

## Progress

Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-import-contract.test.ts` 通过 16 项（[验收凭据](../../evidence/m4-longform/01-longform-contract.txt)）。最小合成样件直接调用真实解析 API，无模型调用或 cassette 需求。

EPUB、DOCX 共用 zip.js（BSD-3-Clause）和 saxes（ISC）；EPUB 的 XHTML 复用 parse5（MIT），保留 nav / NCX / 标题 / spine 提取来源。Markdown 复用已锁定的 mdast 与 GFM 脚注扩展（MIT）。PDF.js（Apache-2.0）自带本地 CMap，实测可读未嵌入字形映射的中文 PDF；纯图片 PDF 不做 OCR。

Review: pass (base 922e6538a6, reviewer Devin Review)。补齐验收凭据；实际 EPUB 回退链及缺失导航样件由 M4/02 验证。
