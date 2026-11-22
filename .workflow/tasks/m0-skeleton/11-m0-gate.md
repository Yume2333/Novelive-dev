# 11: 收敛 Electron、浏览器、原型及 CI 验收

**Effort:** m0-skeleton
**Blocked by:** 10
**Covers:** W1, W2, W4, W5, W6, W7
**Files:** .github/workflows/ci.yml, tests/e2e/m0-gate.spec.ts, .workflow/evidence/m0/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm install --frozen-lockfile && pnpm check && NL_REPLAY=strict pnpm test:e2e` → 冻结安装、严格回放、SQLite/sharp、断开重连和 UI 检查全过。

- [ ] 补 GitHub Actions Linux 校验及 Xvfb sharp 真解码；记录 PR CI 结果。
- [ ] 用 NL_REPLAY=strict pnpm dev:web 验 W4；同视口对比两页并按 W5 记录刻意差异；临时写颜色字面量验证 W6 后还原。
