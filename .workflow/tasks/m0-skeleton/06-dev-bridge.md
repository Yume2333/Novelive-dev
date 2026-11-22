# 06: 完成浏览器开发桥

**Effort:** m0-skeleton
**Blocked by:** 01
**Covers:** W4
**Files:** tools/dev-bridge/src/, tests/unit/m0-dev-bridge.test.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm exec vitest run tests/unit/m0-dev-bridge.test.ts` → 启动真正的本地桥，通过 WebSocket 发送命令并验证 HTTP 资源和重启。

- [ ] 沿用 M0 共享协议；浏览器代理文件夹、日志、重启与资源 URL；只随开发脚本运行，不进 Electron 包。
