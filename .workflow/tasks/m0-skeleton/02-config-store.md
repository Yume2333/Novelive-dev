# 02: 持久化模型与应用设置

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/config/, tests/unit/m0-config.test.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm exec vitest run tests/unit/m0-config.test.ts` → 在真实文件系统临时工程中配置读写、掩码、损坏和备份恢复通过。

- [ ] 五槽配置与继承、原子写入、AES-256-GCM、哨兵保留旧 Key。
- [ ] 坏文件不覆盖；重置产生备份并恢复默认。
