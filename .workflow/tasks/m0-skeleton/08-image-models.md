# 08: 接通图片三项能力测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/image/, tests/unit/m0-image.test.ts, tests/fixtures/image-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-image.test.ts` → 三项能力独立执行，故障映射、透明度及五档尺寸通过。
**Base commit:** 8b98df4519f44c0ddccfb4fb9439a007f55a4141
**Status:** active

- [x] 适配 OpenAI 和 Seedream 的尺寸/质量/错误，并生成可经资源协议读取的缩略图。
- [x] 404 编辑、400 尺寸、无 alpha 与 Seedream 参数错误用严格回放。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-image.test.ts` — 58 passed；`.workflow/evidence/m0-skeleton/08-image-check.txt`。
- `NL_REPLAY=strict pnpm check` — typecheck、Biome、Stylelint、77 tests passed；`.workflow/evidence/m0-skeleton/08-pnpm-check.txt`。
- Real path: Node 调用 `testImage` 服务入口，OpenAI 与 Seedream 各三项通过 SDK strict replay → sharp → 应用缓存 → `cacheResponse(novelive://cache/...)`，六组原图/缩略图均 200；`.workflow/evidence/m0-skeleton/08-image-real-path.txt`。未接 UI/IPC，未做 Electron 界面验收。
- Missing recordings (for main session to record): OpenAI 开发中转 `gpt-image-2.6-sunburst` 文生图、透明底、multipart 编辑真实成功；Seedream 5.5 文生图、透明底、generations + image 编辑真实成功；Seedream 4.5 低档向上吸附尺寸真实成功。现有成功用例全部标 synthetic，不算 W3 真实验收；本分支从未调用付费接口或读取 NL_IMAGE_* 凭据。
- Review: skipped — 当前执行环境未提供独立 reviewer/subagent 工具，未在作者上下文自审盖章；留给主会话独立 flow-verify。
- Files 列表外仅依赖安装必需的 `packages/creator/package.json` / `pnpm-lock.yaml`（按架构锁定 openai 7.62.0）、本任务进度和上述 evidence；无 registry、contract、UI、IPC 变更。无超出既定规格的难逆技术决策。
