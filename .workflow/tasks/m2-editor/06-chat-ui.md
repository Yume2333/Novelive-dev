# 06: 接通可盖层的流式 Agent 面板

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W2
**Files:** packages/ui/src/panels/agent/, tests/e2e/m2-chat.spec.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 chat panel'` → 真实界面能贴图、查看工具细节、暂停或切换会话及分支。

- [ ] 支持全屏切换与快捷键；确认卡说明影响范围、可拒绝并填写理由。
