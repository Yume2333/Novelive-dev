# 01: 建立工作区及桌面启动薄片

**Effort:** m0-skeleton
**Blocked by:** None
**Covers:** W1
**Files:** package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .npmrc, tsconfig.json, vitest.config.ts, playwright.config.ts, biome.json, .stylelintrc.json, .gitignore, tools/patch-sharp.mjs, packages/ui/src/main.tsx, packages/ui/package.json, packages/creator/src/entry.ts, packages/creator/src/contract/, packages/creator/package.json, apps/desktop/package.json, apps/desktop/electron.vite.config.ts, apps/desktop/src/main/index.ts, apps/desktop/src/preload/index.ts, tools/dev-bridge/package.json, tests/e2e/m0-shell.spec.ts, .workflow/standards.md
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `pnpm install --frozen-lockfile && pnpm check && pnpm test:e2e --grep 'M0 desktop shell'` → Linux Electron 渲染空书库并收到创作端 ready；类型、lint 和单测通过。

- [ ] 锁 Node/pnpm/Electron 与架构表；查证锁定依赖可取得，不静默替换；建立四个有内容的包及文档命令。
- [ ] 先把 MessagePort、generation、命令/事件类型、宿主接口和模型命令注册扩展点接通；串行冻结接口后再派发各模块。
- [ ] 实现 Linux sharp 安装补丁和最小 Electron 冒烟；生产不暴露测试命令。
