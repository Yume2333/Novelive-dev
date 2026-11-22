# 08: 验收编辑与对话的组合流程

**Effort:** m2-editor
**Blocked by:** 04, 05, 06, 07
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/ui/src/App.tsx, packages/ui/src/shell/, tests/e2e/m2-gate.spec.ts, .workflow/evidence/m2/
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 revise a work'` → 真实 Electron 从脚本定位原文，分别经两个入口重写，重开验证持久记录。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 接线并比对原型，CJK 文本效果和最小播放器预览保留；严格回放，不新增付费调用。
