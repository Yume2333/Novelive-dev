# 01: 建立工作区及桌面启动薄片

**Effort:** m0-skeleton
**Blocked by:** None
**Covers:** W1
**Files:** package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .npmrc, tsconfig.json, vitest.config.ts, playwright.config.ts, biome.json, .stylelintrc.json, .gitignore, tools/patch-sharp.mjs, packages/ui/src/main.tsx, packages/ui/package.json, packages/creator/src/entry.ts, packages/creator/src/contract/, packages/creator/package.json, apps/desktop/package.json, apps/desktop/electron.vite.config.ts, apps/desktop/src/main/index.ts, apps/desktop/src/preload/index.ts, tools/dev-bridge/package.json, tests/e2e/m0-shell.spec.ts, .workflow/standards.md
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm install --frozen-lockfile && pnpm check && pnpm test:e2e --grep 'M0 desktop shell'` → Linux Electron 渲染空书库并收到创作端 ready；类型、lint 和单测通过。
**Base commit:** 9f38c34441717337f426fffc585e9804a4caceef

- [x] 锁 Node/pnpm/Electron 与架构表；查证锁定依赖可取得，不静默替换；建立四个有内容的包及文档命令。
- [x] 先把 MessagePort、generation、命令/事件类型、宿主接口和模型命令注册扩展点接通；串行冻结接口后再派发各模块。
- [x] 实现 Linux sharp 安装补丁和最小 Electron 冒烟；生产不暴露测试命令。

## Progress

- Check before: 基线 9f38c34 没有根工作区清单、锁文件或 Electron 入口，无法运行此 Check。
- Check after: 冻结安装、类型检查、lint、2 个单测和 2 个 Linux Electron 用例通过；验证空书库、创作端就绪、SQLite、sharp 真解码及关闭调试命令。见 `.workflow/evidence/m0-skeleton/01-check.txt` 和 `.workflow/evidence/m0-skeleton/01-empty-library.png`。
- Real path: `NL_REPLAY=strict pnpm dev` 启动真实 Electron，通过预加载调用 `events.list`，返回第一代创作端的就绪快照；见 `.workflow/evidence/m0-skeleton/01-dev-path.txt`。
- Review: pass (base 9f38c34441717337f426fffc585e9804a4caceef, reviewer Devin Review) — [PR #2](https://github.com/Yume2333/Novelive-dev/pull/2) 独立审查通过。
