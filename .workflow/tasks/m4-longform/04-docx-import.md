# 04: 实现 DOCX 导入

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/docx/, tests/fixtures/source/docx/, tests/unit/m4-docx.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-docx.test.ts` → 标题、段落和注脚正确归档，坏文件给出错误。

- [x] 用合成文档验证，维护共享导入输出形状。

## Progress

- 基于 bb12fa2（M4/01 已落地）；独立 worktree / branch 完成，无共享契约和其他格式改动。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-docx.test.ts` → 1 file passed, 18 tests passed；包含本地合成 DOCX 文件经 `importDocx(sourcePath)` 的实际入口运行。Receipt: `.workflow/evidence/m4-longform/04-docx-check.txt`。
- `pnpm typecheck` → exit 0；`pnpm lint` → exit 0（既有 `tests/fixtures/text-models/build-synthetic.ts:63` useTemplate info，不改无关文件）。
- Review: skipped — 当前会话未提供 reviewer / subagent / isolated session 启动工具，无法运行独立 flow-verify（包括不可信输入的 security-reviewer）；未将作者自查标为独立审查通过。PR #46 Devin Review 的七项意见已处理，需在修订后独立复审。
- 复用 zip.js / saxes；单标题层级作为章，多层级最浅作为卷；按 Word 段落调用 TXT 净化分类，分类前遮蔽对白中的网址（非整段网址），正文保留原字面值；长章使用 TXT 的长度上限。空章省略，纯附注章附注保留到相邻有正文的章。
- 当前 DOCX 契约不含 illustrations，图片不混入正文、不新增字段；不改契约。未运行 Electron 界面导入（待向导接线）。按本次要求保留任务文件原位置，不 archive / land 到 main。
