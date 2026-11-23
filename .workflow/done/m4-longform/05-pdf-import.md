# 05: 实现可提取文字的 PDF 导入

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/pdf/, tests/fixtures/source/pdf/, tests/unit/m4-pdf.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-pdf.test.ts` → 可选文字 PDF 生成章节；图像型扫描 PDF 明确提示不可导入。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff

- [x] 不引入 OCR，按文档保留正文及分页合并语义。

## Progress

Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-pdf.test.ts` 通过 8 项；`pnpm typecheck`、`pnpm lint`、`workflow validate` 通过（原有 useTemplate info 不阻塞）。契约与解析器探针初版另通过 16 项。[验收凭据](../../evidence/m4-longform/05-pdf-import.txt)。

复用 M4/01 已锁定的 PDF.js 6.4.299 和本地 CMap，不新增依赖。按页提取文本，以换行合并后复用 TXT 章节、净化和长章切分规则；分页不产生章节。无可提取文字返回契约的 unsupported / no_extractable_text，不执行 OCR；损坏文件保留解析错误。合成样件及确定性生成器均入库。

Review: skipped — 当前工具目录无可启动的独立 reviewer；留待集成审查，不在作者上下文自批。

实际解析入口由严格离线 CLI 调用验证；桌面格式注册与向导展示由后续集成任务连接，本任务未改共享注册表或 UI。

Review fix: 视觉行按 y/height 重建；大行距、缩进、句末标点或标题形成段界，其余软换行合并，跨页同样处理。中日韩文本直接相连，拉丁文本补单空格，小写续接的行末连字符去除；页首页尾纯页码剔除。新增跨页中文、带页码英文及行距/缩进合成样件。
