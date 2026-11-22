# 11: 收敛 Electron、浏览器、原型及 CI 验收

**Effort:** m0-skeleton
**Blocked by:** 10
**Covers:** W1, W2, W4, W5, W6, W7
**Files:** .github/workflows/ci.yml, tests/e2e/m0-gate.spec.ts, .workflow/evidence/m0/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm install --frozen-lockfile && pnpm check && NL_REPLAY=strict pnpm test:e2e` → 冻结安装、严格回放、SQLite/sharp、断开重连和 UI 检查全过。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** dc177952b64ad4ae5d6f5358296d2dd9132c24b1
**Status:** paused

- [x] 补 GitHub Actions Linux 校验及 Xvfb sharp 真解码；记录分支 CI 结果（本次不创建 PR）。
- [x] W4 浏览器成功回放：以 `NL_REPLAY=strict pnpm dev:web` 分别启动文本和图片用例，`NL_CASSETTE_DIR` 指向从仓库根解析的 `tests/fixtures/text-models/smoke/` 和 `tests/fixtures/image-models/smoke/`，复用 W2 的 smoke 配置与 cassette。在浏览器设置页点击测试，确认三种文本协议和图片三项能力成功，并确认缩略图经 dev-bridge 资源地址加载。
- [x] W4 浏览器失败回放：另起严格回放进程，`NL_CASSETTE_DIR` 分别指向从仓库根解析的 `tests/fixtures/text-models/synthetic/` 和 `tests/fixtures/image-models/`；在设置页验证文本慢流取消、断线重试耗尽后显示 `network`，以及图片故障显示对应能力的错误而不是成功。
- [x] W4 浏览器宿主：结束故障回放进程，重新以 `NL_REPLAY=strict pnpm dev:web` 启动开发桥，将 `NL_CASSETTE_DIR` 切回待重测的文本或图片 `smoke/` 绝对路径，不沿用故障目录。调用 `host.openLogDir()`，确认终端打印日志目录；在此 smoke 会话调用 `host.restartCreator()`，等创作端重新就绪，再用同一 smoke 配置点击设置页的对应测试并确认成功。
- [x] 同视口对比两页并按 W5 记录刻意差异；临时写颜色字面量验证 W6 后还原。
- [ ] 由未参与编写的审查 agent 验收 W5，并完成里程碑审查。

## Progress

- Check before: `pnpm check` 在主线基线的 W3 replay README 上报 Biome 表格格式错误；已修复。W7 首跑用 patchelf 0.18.0 处理 sharp 后出现 SIGSEGV；已复现并改用经校验的 0.19.3。
- Check after: 冻结安装成功，`pnpm check` 129 项通过，`NL_REPLAY=strict xvfb-run -a pnpm test:e2e` 13 项通过，W6 颜色字面量按预期失败并已还原。[本地凭据](../../evidence/m0/gate/11-local-checks.txt) · [W7 CI](../../evidence/m0/gate/11-linux-ci.txt)
- Real path: 复用 M0/10 的 W3 实录凭据，在 Electron 新档案中严格回放成功、鉴权和审核用例，并验证重启持久化；W4 两组 smoke、两组故障、终端目录、重启及切回 smoke 后重测均通过。[W4 凭据](../../evidence/m0/gate/11-browser-checks.txt) · [W5 对照](../../evidence/m0/gate/11-prototype-comparison.md)。门禁付费调用为零。
- Review: skipped — 当前会话没有可用的独立审查 agent。交接：在分支 `m0-skeleton/11-m0-gate` 结束独立 W5 和里程碑审查，再归档并更新规格状态；[关闭记录](../../done/m0-skeleton/closeout.md)已准备。
