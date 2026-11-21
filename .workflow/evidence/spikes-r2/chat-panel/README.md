# chat-panel（R2 对话面板 assistant-ui 试验）

验证内容：`ExternalStoreRuntime` + 自管 transcript 树（id/parentId 分支）接 assistant-ui 0.15；`tool-call` part 挂 `approval` 画确认卡（接受/拒绝+理由）；用户消息编辑→分支切换（BranchPicker）；streamdown CJK 流式渲染；park/恢复语义。支撑报告 `.workflow/research/refs/ext-2026-11-r2-chat-panel.md`；gap-ledger D 表 FakeCreatorBackend 行。

文件：`src/fakeBackend.ts`（324 行，id/parentId 树+park 语义+事件流）、`src/App.tsx`（237 行，ExternalStoreRuntime 接线+ProposalCard）、`trial.spec.ts`+`verify-branch.ts`+`cjk-test.ts`（Playwright）、`shots/`（7 张冒烟截图）、`test-results/.last-run.json`。`package-lock.json`（206KB>200KB 上限）、`dist/`、`node_modules/` 未拷。

重跑：`npm install`（`@assistant-ui/react@0.15.37`、`streamdown@2.8.0`、react 19.2、vite 7、playwright 1.65）→ `npm run dev`（端口 5199）→ 另开 `npx playwright install chromium && npx playwright test trial.spec.ts` 或 `node verify-branch.ts`。

第三方依赖：`@assistant-ui/react`（MIT）、`streamdown`（MIT，Vercel）、playwright（Apache-2.0）。原目录还解包了 `assistant-ui` 源码仓库（`aui-repo`，MIT）供参考 `messageProjection.ts`/`hostUi.ts`/`threadState.ts`——那是第三方 repo 未拷，需要时从 `github.com/assistant-ui/assistant-ui` 拉（gap-ledger D 表注明「只参考不拷」）。
