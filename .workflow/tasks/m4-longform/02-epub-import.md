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
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-epub.test.ts` → `Test Files 1 passed (1)` / `Tests 19 passed (19)`。解包、nav → NCX → heading → spine、图片定位已实跑；分类标签用 mock 验证，真实 strict 缺档拒绝及零网络调用已验证，**成功视觉分类回放尚缺 cassette，不视为完成该项验收**。
- `pnpm typecheck` 退出 0；`pnpm lint` 退出 0（既有 `tests/fixtures/text-models/build-synthetic.ts:63:3 lint/style/useTemplate` info 未改）。导入关联测试 `m1a-txt`、`m1b-import-wizard`、`m4-import-contract`、`m1b-production-worker` 连同当时 17 项 EPUB 测试：`Test Files 5 passed (5)` / `Tests 84 passed (84)`；新增两项 EPUB 用例后目标 19 项通过。
- 缺档交接：需要协调者提供 EPUB 插图分类的「角色匹配设定集」「场景匹配设定集」「无关装饰」三个成功 cassette（可补错误 JSON 用例）。请求包含合成图片经 sharp 转 PNG、设定集及附近正文；使用本模块固定提示词与指定视觉模型录制后，再补成功 strict 回放断言。没有录制任何 cassette，没有付费调用。当前仅证明缺档时不会联网，不以不相关旧 cassette 伪装成功分类。
- Review: skipped — 当前宿主未提供独立审查工具，交主线独立复核；未进行 Electron 导入接线或界面验收（不在本任务允许修改范围）。
