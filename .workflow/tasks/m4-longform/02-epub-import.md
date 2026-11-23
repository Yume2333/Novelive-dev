# 02: 实现 EPUB 导入及插图候选

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/epub/, tests/fixtures/source/epub/, tests/unit/m4-epub.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-epub.test.ts` → nav、NCX、标题和 spine 层级逐级回退，图片定位及视觉分类可回放。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [x] 提取章节和插图，排除私有数据；以已有研究片段为参照，保留手选候选。

## Progress

- 实现 `extractEpub(bytes)`，结果兼容 M4/01 的 `ImportExtraction` / `ExtractedBook`；附内存图片字节表，不落盘。参考 `.workflow/research/snippets/import/epub.mjs` 的四级链，使用现有 zip.js / saxes，保留段落、同文件锚点、嵌套卷、前言和 spine 顺序；合成 EPUB 覆盖真实解包入口，不含私有数据。
- 插图定位保留章内附近段落；manifest 未内联图片保留为无段落位置候选。`illustrationCandidates` 无模型也能手选；`classifyIllustrations` 复用现有 `artJson` 与 strict replay，分类不会自动选中或删除无关图片。未增加依赖，未改应用接线。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-epub.test.ts` → `Test Files 1 passed (1)` / `Tests 30 passed | 1 skipped (31)`；跳过的是需显式选择模式的供应商驱动，默认 CI 成功回放三个公开合成分类 cassette，并验证缺档零网络降级。
- 协调者于 2026-11-23 授权录制后，视觉模型 `gemini-3.8-flash` 的角色/场景/无关三类真实录制均成功；`NL_REPLAY=strict NL_EPUB_PROVIDER_MODE=strict pnpm exec vitest run tests/unit/m4-epub.test.ts -t 'EPUB classification provider driver'` → `Tests 1 passed | 30 skipped (31)`，实跑三个私有成功分类、无网络。原始供应商 cassette 留在 `~/.local/novelive-epub-provider/`；公开仅提交合成 cassette、固定 PNG 和回执 `tests/fixtures/source/epub/receipt.md`，不混淆二者证据。
- 用量逐调用追加到私有 `usage.csv`：三个成功请求共输入 3666 + 输出 655 = 4321 tokens，另一次 HTTP 404 保留 40000-token 上界。共 4 次请求、4 张输入图片、0 张生成图片；计入预留 44321 tokens。无缺失成功 cassette。
- `pnpm typecheck`、`pnpm lint` 均退出 0（既有 `tests/fixtures/text-models/build-synthetic.ts:63:3 lint/style/useTemplate` info 未改）。导入关联测试 `m1a-txt`、`m1b-import-wizard`、`m4-import-contract`、`m1b-production-worker` 与最初 EPUB 测试曾合计 `Tests 84 passed (84)`。
- Review: PR #48 Devin Review 的八项均先用具体输入复现，再分别修复并提交：article 段落合并、行内锚点丢章、混合正文丢失、源码换行伪分段、脚注未入附注、插图独页错配第一章、未定位图片伪上下文、标题回退超出文档。对应 `93fd55a`、`7452eef`、`de9100b`、`e1623cc`、`6ba3255`、`f00eba2`、`d0459e1`、`539531f`。未进行 Electron 导入接线或界面验收（不在本任务允许修改范围）。
