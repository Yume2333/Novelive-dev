# 05: 完成宿主崩溃恢复与资源协议

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W2
**Files:** apps/desktop/src/main/, apps/desktop/src/preload/, packages/creator/src/host-runtime/, tests/e2e/m0-lifecycle.spec.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm test:e2e --grep 'M0 creator lifecycle and protocol'` → 真实 Electron 断开、重连、在途拒绝、断路器和协议/SQLite/sharp 冒烟通过。
**Base commit:** a156b754a33242e59b00c194898964c99419cec0

- [x] 接通宿主生命周期、代际过滤、通讯补漏、手动重启、日志、选文件夹与资源路径限制。
- [x] 测试进程退出和 stale 请求；sharp/SQLite 调试命令仅 NL_E2E=1。

## Progress

- Check before: 基线 a156b75 无崩溃自动恢复、断路器和缓存协议。
- Check after: 指定 Electron 测试两项通过，类型检查通过。[检查日志](../../evidence/m0-skeleton/05-lifecycle-check.txt)
- Real path: 开发入口手动重启至新代际、SQLite WAL 读写与 sharp 真解码。[实际运行输出](../../evidence/m0-skeleton/05-lifecycle-real-path.txt)
- Review: skipped — 当前会话未进行独立工作流与安全审查。
