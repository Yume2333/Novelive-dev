# 01: 锁定创作贯通协议与资源接口

**Effort:** m1b-production
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/creator/src/contract/production.ts, packages/format/src/model/production.ts, packages/player/package.json, packages/player/src/index.ts, pnpm-lock.yaml, packages/ui/src/routes/production.ts, tests/unit/m1b-production-contract.test.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1b-production-contract.test.ts` → 作品状态、发布、资源、停止与素材队列契约符合 schema。

- [ ] 锁定并行任务所需协议、挂载点与播放器只依赖 format 的接口；在播放器清单锁定 PixiJS 8，提交最小可执行固定场景渲染入口。
