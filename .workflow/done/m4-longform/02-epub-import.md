# 02: 实现 EPUB 导入及插图候选

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W1
**Files:** packages/creator/src/import/epub/, tests/fixtures/source/epub/, tests/unit/m4-epub.test.ts, tests/e2e/m4-epub-screening.spec.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-epub.test.ts` → nav、NCX、标题和 spine 层级逐级回退，图片定位及视觉分类可回放。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** e9616cdd14559011146faf8db4335e532b80afb3

- [x] 提取章节和插图，排除私有数据；以已有研究片段为参照，保留手选候选。

## Progress

- 本轮在角色设定 / 主视觉确认点接入 `classifyIllustrations`：优先保留手选，预选模型推荐；可展开未推荐项。筛选失败时完整展示所有插图并提示。沿用制作角色的模型槽映射；为低成本筛选，将 `EPUB 插图筛选` 角色指向使用 `gemini-3.5-flash-lite` 的槽。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-epub.test.ts` → `Test Files 1 passed (1)` / `Tests 45 passed | 1 skipped (46)`。新用例回放角色、场景、无关三类，并验证手选仍在候选中、缺档时不清空候选且不联网。
- Electron 视觉确认路径：`NL_REPLAY=strict xvfb-run -a pnpm exec playwright test tests/e2e/m4-epub-screening.spec.ts` → `2 passed (2.4s)`。用合成制作快照验证推荐预选、展开未推荐项、手动覆盖及失败提示下的全量候选；实看[手动覆盖](../../evidence/m4-longform/02-epub-override.png)和[失败降级](../../evidence/m4-longform/02-epub-fallback.png)截图。
- 公版实书烟测：Gutenberg #28885（Rackham 插图版），`gemini-3.5-flash-lite` 实际分类返回 `character`，1 次调用、1473 输入 + 36 输出 = 1509 tokens、1 张输入图、0 张生成图。共享台账未挂载，按接手要求在[既有供应商回执](../../../tests/fixtures/source/epub/receipt.md)记录。
- Review: skipped — 当前会话无可启动独立 reviewer 的工具；下列 PR #48 的审查记录仅覆盖先前实现。

- 实现 `extractEpub(bytes)`，结果兼容 M4/01 的 `ImportExtraction` / `ExtractedBook`；附内存图片字节表，不落盘。参考 `.workflow/research/snippets/import/epub.mjs` 的四级链，使用现有 zip.js / saxes，保留段落、同文件锚点、嵌套卷、前言和 spine 顺序；合成 EPUB 覆盖真实解包入口，不含私有数据。
- 插图定位保留章内附近段落；manifest 未内联图片保留为无段落位置候选。`illustrationCandidates` 无模型也能手选；`classifyIllustrations` 复用现有 `artJson` 与 strict replay，分类不会自动选中或删除无关图片。未增加依赖，未改应用接线。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-epub.test.ts` → `Test Files 1 passed (1)` / `Tests 38 passed | 1 skipped (39)`；跳过的是需显式选择模式的供应商驱动，默认 CI 成功回放三个公开合成分类 cassette，并验证缺档零网络降级。
- 协调者于 2026-11-23 授权录制后，视觉模型 `gemini-3.8-flash` 的角色/场景/无关三类真实录制均成功；`NL_REPLAY=strict NL_EPUB_CASSETTE_DIR='' NL_EPUB_PROVIDER_MODE=strict pnpm exec vitest run tests/unit/m4-epub.test.ts -t 'EPUB classification provider driver'` → `Tests 1 passed | 38 skipped (39)`，实跑三个私有成功分类、无网络，空目录变量正确回落私有默认路径。原始供应商 cassette 留在 `~/.local/novelive-epub-provider/`；公开仅提交合成 cassette、固定 PNG 和回执 `tests/fixtures/source/epub/receipt.md`，不混淆二者证据。
- 用量逐调用追加到私有 `usage.csv`：三个成功请求共输入 3666 + 输出 655 = 4321 tokens，另一次 HTTP 404 保留 40000-token 上界。共 4 次请求、4 张输入图片、0 张生成图片；计入预留 44321 tokens。无缺失成功 cassette。
- `pnpm typecheck`、`pnpm lint` 均退出 0（既有 `tests/fixtures/text-models/build-synthetic.ts:63:3 lint/style/useTemplate` info 未改）。导入关联测试 `m1a-txt`、`m1b-import-wizard`、`m4-import-contract`、`m1b-production-worker` 与最初 EPUB 测试曾合计 `Tests 84 passed (84)`。
- 历史评审：PR #48 Devin Review 的八项均先用具体输入复现，再分别修复并提交：article 段落合并、行内锚点丢章、混合正文丢失、源码换行伪分段、脚注未入附注、插图独页错配第一章、未定位图片伪上下文、标题回退超出文档。对应 `93fd55a`、`7452eef`、`de9100b`、`e1623cc`、`6ba3255`、`f00eba2`、`d0459e1`、`539531f`。该评审未覆盖后续 Electron 接线或界面验收。
- 第二轮四项亦已复现并分别修复：重做标题回退，达到研究片段的关键词覆盖门槛后每个 spine 文件均有标记，避免无关键词文件被并入前章（`4910bd6`）；纯附注前页延迟归入首章（`e5322ec`）；供应商用量不完整时保留预留，不把缺值当零（`912e3e4`）；录制先回放已有请求，仅缺档才写入并付费，避免同 key 追加旧响应优先（`e650f0a`）。本轮无新增供应商调用。
- 第三轮两项已复现并分别修复：标题覆盖门槛只计有正文文件，封面/纯附注文件不降低覆盖率（`e4bd9a7`）；录制不持久化新的 HTTP 错误响应，并允许 `NL_EPUB_CASSETTE_DIR` 选择新私有目录（`4cf3467`）。已有历史错误行不删除；如需替换旧错误，授权后选择新目录。无新增供应商调用；按协调者要求本轮推送后不等待下一轮审查。
- 协调者追加第四轮的两项已复现并分别修复：后续 spine 文件标题前的题记归该文件首章，不串入前章（`9de9def`）；空 `NL_EPUB_CASSETTE_DIR` 视为未设置，避免把私有响应写入工作目录（`f9d609d`）。全部检查通过；无新增供应商调用，按本轮要求最后推送后立即交回协调者，不继续等待审查。
