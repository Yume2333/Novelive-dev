# 08: 接通图片三项能力测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/image/, tests/unit/m0-image.test.ts, tests/fixtures/image-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-image.test.ts` → 三项能力独立执行，故障映射、透明度及五档尺寸通过。
**Base commit:** 8b98df4519f44c0ddccfb4fb9439a007f55a4141

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [x] 适配 OpenAI 和 Seedream 的尺寸/质量/错误，并生成可经资源协议读取的缩略图。
- [x] 404 编辑、400 尺寸、无 alpha 与 Seedream 参数错误用严格回放。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-image.test.ts` — 77 passed；`.workflow/evidence/m0-skeleton/08-review-fixes-check.txt`。
- `NL_REPLAY=strict pnpm check` — typecheck、Biome、Stylelint、96 tests passed；`.workflow/evidence/m0-skeleton/08-review-fixes-pnpm-check.txt`。
- PR #9 review fixes: 仅按地址选协议（中转上的 Seedream 名称仍走 OpenAI）；Ark 不明版本尺寸取交集 3686400–4624220；URL 下载加 90 秒期限并合并调用者取消；Seedream `data[].error` 复用 API 错误分类。新增 strict synthetic 用例，未发真实网络请求。
- Real path: Node 调用 `testImage` 服务入口，OpenAI 与 Seedream 各三项通过 SDK strict replay → sharp → 应用缓存 → `cacheResponse(novelive://cache/...)`，六组原图/缩略图均 200；`.workflow/evidence/m0-skeleton/08-image-real-path.txt`。未接 UI/IPC，未做 Electron 界面验收。
- Missing recordings (for main session to record): OpenAI 开发中转 `gpt-image-2.6-sunburst` 文生图、透明底、multipart 编辑真实成功；Seedream 5.5 文生图、透明底、generations + image 编辑真实成功；Seedream 4.5 低档向上吸附尺寸真实成功。现有成功用例全部标 synthetic，不算 W3 真实验收；本分支从未调用付费接口或读取 NL_IMAGE_* 凭据。
- Smoke 前置：已合入的离线 Check 仍使用 `tests/fixtures/image-models/` 下的合成 cassette；主线在 `m0-skeleton/12` 录制 M0/09 所需的最小成功集（文生图、透明底、编辑各一）。M0/09 依赖 12 完成，不以合成结果替代。
- Review: pass (base 8b98df4519f44c0ddccfb4fb9439a007f55a4141, reviewer lead session) — independent review of diff vs 8b98df4 by lead session (no blocking findings; checked size snapping vs docs/visuals.md §3.2, Seedream fixed params, error mapping, data[].background check).
- Review: pass (base 8b98df4519f44c0ddccfb4fb9439a007f55a4141, reviewer Devin Review) — [PR #9](https://github.com/Yume2333/Novelive-dev/pull/9) independent review passed.
- Files 列表外仅依赖安装必需的 `packages/creator/package.json` / `pnpm-lock.yaml`（按架构锁定 openai 7.62.0）、本任务进度和上述 evidence；无 registry、contract、UI、IPC 变更。无超出既定规格的难逆技术决策。
