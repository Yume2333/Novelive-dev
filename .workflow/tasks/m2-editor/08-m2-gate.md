# 08: 验收编辑与对话的组合流程

**Effort:** m2-editor
**Blocked by:** 04, 05, 06, 07
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/ui/src/App.tsx, packages/ui/src/shell/, tests/e2e/m2-gate.spec.ts, .workflow/evidence/m2/
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 revise a work'` → 真实 Electron 从脚本定位原文，分别经两个入口重写，重开验证持久记录。

- [ ] 接线并比对原型，CJK 文本效果和最小播放器预览保留；严格回放，不新增付费调用。
