# 03: 实现 Markdown 导入

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/markdown/, tests/fixtures/source/markdown/, tests/unit/m4-markdown.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-markdown.test.ts` → 标题、分卷、段落及非正文正确归档。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff

- [x] 解析实际合成 Markdown 文件，不要求模型识别文本边界。

## Progress
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-markdown.test.ts` → 11 passed；Setext 与 ATX 两份多卷 fixture 抽取结果一致并通过导入契约校验，目录、版权、脚注、注释进 notes。真实入口 `pnpm exec tsx tests/fixtures/source/markdown/extract.ts <file>` 跑通两份 fixture。收据：`.workflow/evidence/m4-longform/03-markdown-import.txt`。无模型调用，不需要 cassette。
- Review: pass (base bb12fa20a21b5fb537757a0b3b9e4005adebd6ff, reviewer devin-review)；PR #49 Devin Review 各轮意见（front matter 判定、YAML 标量/流式集合/节点属性/带引号键、注释换行、标题脚注、HTML 注释、正则回溯）均已修复并补回归测试。合入 main 后全量 `NL_REPLAY=strict pnpm test` 42 files / 558 passed，仅 `tests/integration/m3-upscale.test.ts` 5 例因本机 `upscayl-bin` 报 `Invalid GPU Device` 失败（M3 环境问题，CI 通过）；`pnpm typecheck`、`biome check` 通过。
