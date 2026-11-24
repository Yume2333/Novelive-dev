# 01: 固定完整演出与进度接口

**Effort:** m3-playback
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/player/src/contract/, packages/ui/src/routes/player.ts, tests/unit/m3-contract.test.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m3-contract.test.ts` → 编译事件、舞台状态和进度数据接口符合约定。

- [x] 确立 UI、Pixi、历史持久化、资源与章末事件的边界，后续并行。

## Progress

- 契约已落在 `packages/player/src/contract/`（chapter、playback、progress、stage 类型与 index），UI 经 `packages/ui/src/routes/player.ts` 引用，后续任务（02 舞台、03 文本、04 进度、05 控制）均在此接口上并行实现并已合入 main。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m3-contract.test.ts` → `Test Files 1 passed (1)` / `Tests 6 passed (6)`（2026-11-24 于 nl-01 worktree，Node v24.22.3 实跑）。
- Review: pass (independent reviewer, 2026-11-24, window 01) — 独立只读审查核对契约类型与单测；初轮对 `expectTypeOf` 仅编译期断言是否生效存疑，补充证据 `pnpm typecheck`（`tsc --noEmit`，仓库 `pnpm check` 门禁）实跑 exit 0 后裁定通过，无存活发现。
