# 09: 交付用量和过期提示

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2, W3
**Files:** packages/creator/src/usage/, packages/creator/src/bible/staleness/, packages/ui/src/pages/usage/, tests/e2e/m4-usage.spec.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 usage and stale assets'` → 真实面板展示已发生用量，编辑设定引发正确过期投影。
**Base commit:** bb12fa20a21b5fb537757a0b3b9e4005adebd6ff

- [x] 用量只作参考，不引入产品预算停机；按交接默认传播范围，风格改动只提示。

## Progress

Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M4 usage and stale assets'` → 1 passed (8.7s). [验收凭据](../../evidence/m4-longform/09-usage-staleness.txt)，[用量面板](../../evidence/m4-longform/09-usage-staleness.png)，[过期素材](../../evidence/m4-longform/09-stale-assets.png)。`pnpm typecheck`、`pnpm lint` 和相关 71 项单测通过。

真实入口：Electron 侧栏打开用量；严格回放已有写作/审稿和出图 cassette 后经 IPC 读取 project.db；设定集接受风格、外貌、造型和地点修改，再到用量页核对过期素材，重载保留用量。未调用付费接口。

复用既有 usage 表和 M4/01 ProductionUsage 契约；异步调用上下文归属到作品/阶段，文本逐次记录提供者返回的 tokens，图片按真实返回数量记录，不估算、不设置预算停机。传播复用既有设定确认入口，CG 和无关素材不受影响，风格只显示提示。页面复用外壳 ScrollArea 和字体 Tokens。

Review: skipped — host 未提供独立 reviewer/subagent/session 工具；需在里程碑 flow-close 补独立审查。
