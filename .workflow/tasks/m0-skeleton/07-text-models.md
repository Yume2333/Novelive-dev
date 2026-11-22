# 07: 接通文本和视觉模型测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/text/, tests/unit/m0-text.test.ts, tests/fixtures/text-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-text.test.ts` → 三种协议及带图视觉测试的成功、错误、重试、取消路径回放通过。

- [ ] pi Model 格式与 compat、上下文校验、三协议 L3 fetch；按规格区分看门狗、中止和网络错误。
- [ ] 用 L1 假模型覆盖工具循环中的取消。
