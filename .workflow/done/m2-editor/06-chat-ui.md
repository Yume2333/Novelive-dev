# 06: 接通可盖层的流式 Agent 面板

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W2
**Files:** packages/ui/src/panels/agent/, tests/e2e/m2-chat.spec.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 chat panel'` → 真实界面能贴图、查看工具细节、暂停或切换会话及分支。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** 0bf76ad045f9180ed1683ab7a372974519b557e4

- [x] 支持全屏切换与快捷键；确认卡说明影响范围、可拒绝并填写理由。

## Progress

- Check before: 基线 0bf76ad 没有 `tests/e2e/m2-chat.spec.ts`，也没有 Agent 面板，`--grep 'M2 chat panel'` 匹配不到用例。
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 chat panel'` 1 passed；真实 Electron 窗口经测试投影的创作端端口回放 `chat.*` 与 `chat.message` 事件，验证贴图上传、工具参数与结果、流式中停止、切换分支与会话、确认卡影响范围与带理由拒绝、全屏与 Ctrl+J。`pnpm check` 通过（337 个单测）。截图见 `.workflow/evidence/m2-editor/06-tool-detail.jpg`、`06-streaming.jpg`、`06-fullscreen.jpg`。
- Cassette: 本任务不调用模型，测试用确定的创作端投影，不需要录制 cassette。
- Real path: 构建后的 Electron 接真实创作端，作品页 Ctrl+J 打开面板，显示「无法读取会话」：真实创作端尚未注册 `chat.list`（由 03 接通），见 `.workflow/evidence/m2-editor/06-real-path.jpg`。03 落地后 08 的门禁复跑真实会话。
- Review: pass (base 0bf76ad045f9180ed1683ab7a372974519b557e4, reviewer Devin Review) — [PR #36](https://github.com/Yume2333/Novelive-dev/pull/36) 独立审查三轮：修复多图首发拆会话、编辑重发丢图、回读失败诱发重发、新开面板 Esc 失效、图片 URL 泄漏、输入框放大编辑、次级输入框滚动条与等待动效 Token；重写差异勾选属于 07，不在本任务内。
