# 01: 固定完整演出与进度接口

**Effort:** m3-playback
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/player/src/contract/, packages/ui/src/routes/player.ts, tests/unit/m3-contract.test.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m3-contract.test.ts` → 编译事件、舞台状态和进度数据接口符合约定。

- [ ] 确立 UI、Pixi、历史持久化、资源与章末事件的边界，后续并行。
