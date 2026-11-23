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

Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-pdf.test.ts` 通过 19 项；`pnpm typecheck`、`pnpm lint`、`workflow validate` 通过（原有 useTemplate info 不阻塞）。契约与解析器探针初版另通过 16 项。[验收凭据](../../evidence/m4-longform/05-pdf-import.txt)。

复用 M4/01 已锁定的 PDF.js 6.4.299 和本地 CMap，不新增依赖。按页提取文本，以换行合并后复用 TXT 章节、净化和长章切分规则；分页不产生章节。无可提取文字返回契约的 unsupported / no_extractable_text，不执行 OCR；损坏文件保留解析错误。合成样件及确定性生成器均入库。

Review: skipped — 当前工具目录无可启动的独立 reviewer；留待集成审查，不在作者上下文自批。

实际解析入口由严格离线 CLI 调用验证；桌面格式注册与向导展示由后续集成任务连接，本任务未改共享注册表或 UI。

Review fix: 视觉行按 y/height 重建；大行距、缩进、句末标点或标题形成段界，其余软换行合并，跨页同样处理。中日韩文本直接相连，拉丁文本补单空格，小写续接的行末连字符去除；页首页尾纯页码剔除。新增跨页中文、带页码英文及行距/缩进合成样件。

PR review: 已隔离注释/水印行，段间空行关闭注释块；裸数字页码须有偏移布局和跨页一致编号证据；连续重复页眉页脚剔除。D 待决：TXT 保留纯附注章节，但 M4/01 共享契约要求每章至少一段正文；未擅改共享 schema，PDF 的纯附注章过滤暂留，需集成决定契约如何容纳它。

Round 2: 页眉页脚须由明显大于正文行距的间隔划区；正文边距/行距不含区内行。仅区内重复行剔除，正文重复保留；裸页码须三页一致编号，取消 x 限制。注释在同页软换行续接，换页关闭；跨页统计用 Map/Set 线性索引。详见凭据中的逐项提交与样件说明。

Round 3: 页眉页脚与最近已输出标题一致时剔除；稀疏页首尾显式页码不要求划区；注释续行字号须在起始字号 max(0.5pt, 10%) 容差内。三项各有合成样件和回归测试。
