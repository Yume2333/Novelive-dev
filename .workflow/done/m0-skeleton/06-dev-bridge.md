# 06: 完成浏览器开发桥

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W4
**Files:** tools/dev-bridge/src/, tests/unit/m0-dev-bridge.test.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm exec vitest run tests/unit/m0-dev-bridge.test.ts` → 启动真正的本地桥，通过 WebSocket 发送命令并验证 HTTP 资源和重启。
**Base commit:** a156b754a33242e59b00c194898964c99419cec0

- [x] 沿用 M0 共享协议；浏览器代理文件夹、日志、重启与资源 URL；只随开发脚本运行，不进 Electron 包。

## Progress

- Check before: 基线 a156b75 只有帧编解码，没有可运行的开发桥。
- Check after: 指定 Vitest 测试及类型检查通过。[检查日志](../../evidence/m0-skeleton/06-dev-bridge-check.txt)
- Real path: `NL_REPLAY=strict pnpm dev:web` 在 Chromium 实测宿主日志、重启、WebSocket 命令和 HTTP 图片。[实际运行输出](../../evidence/m0-skeleton/06-dev-bridge-real-path.txt)
- Review: pass (base a156b754a33242e59b00c194898964c99419cec0, reviewer Devin Review) — [PR #7](https://github.com/Yume2333/Novelive-dev/pull/7) 独立审查通过。
- PR #7 合并复验: 保留 Electron UI 和开发桥两套依赖；冻结安装、开发桥 Check 和完整检查通过。首次并行 E2E 争用 Electron 下载，安装完成后重跑通过。[检查日志](../../evidence/m0-skeleton/06-dev-bridge-merge-check.txt) · [Chromium 真实路径](../../evidence/m0-skeleton/06-dev-bridge-merge-real-path.txt)
