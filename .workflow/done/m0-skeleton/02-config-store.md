# 02: 持久化模型与应用设置

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W2
**Files:** packages/creator/src/config/, tests/unit/m0-config.test.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm exec vitest run tests/unit/m0-config.test.ts` → 在真实文件系统临时工程中配置读写、掩码、损坏和备份恢复通过。
**Base commit:** 627385eb76b0fe9df7e0b2f69275318c137cde5c

- [x] 五槽配置与继承、原子写入、AES-256-GCM、哨兵保留旧 Key。
- [x] 坏文件不覆盖；重置产生备份并恢复默认。

## Progress

- Check before: 基线 627385e 尚无配置模块或该测试文件。
- Check after: `pnpm exec vitest run tests/unit/m0-config.test.ts` 在真实临时目录完成，`Test Files  1 passed (1)`、`Tests  7 passed (7)`。
- Real path: Electron 45.4.1 的 utility process 使用隔离的 `userData`，跨进程验证加密保存、掩码重读、快速槽连接继承，并确认损坏文件禁止更新且重置保留逐字节相同的备份。未修改生产入口；设置页命令接线留给 09。
- Review: skipped — 当前会话无法启动独立工作流与安全审查员，留待 PR 审查。
