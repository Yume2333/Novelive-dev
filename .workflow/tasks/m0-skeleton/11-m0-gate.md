# 11: 收敛 Electron、浏览器、原型及 CI 验收

**Effort:** m0-skeleton
**Blocked by:** 10
**Covers:** W1, W2, W4, W5, W6, W7
**Files:** .github/workflows/ci.yml, tests/e2e/m0-gate.spec.ts, .workflow/evidence/m0/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm install --frozen-lockfile && pnpm check && NL_REPLAY=strict pnpm test:e2e` → 冻结安装、严格回放、SQLite/sharp、断开重连和 UI 检查全过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 补 GitHub Actions Linux 校验及 Xvfb sharp 真解码；记录 PR CI 结果。
- [ ] 用 NL_REPLAY=strict pnpm dev:web 验 W4；同视口对比两页并按 W5 记录刻意差异；临时写颜色字面量验证 W6 后还原。
