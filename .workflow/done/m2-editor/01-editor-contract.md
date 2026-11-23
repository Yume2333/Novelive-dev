# 01: 冻结编辑、重写及会话契约

**Effort:** m2-editor
**Blocked by:** None
**Covers:** W1, W2, W3
**Files:** packages/creator/src/contract/editor.ts, packages/creator/src/contract/chat.ts, packages/ui/package.json, pnpm-lock.yaml, tests/unit/m2-contract.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-contract.test.ts` → 命令请求、旧值版本和提议载荷校验通过。
**Base commit:** ea99733e566c72be5873d6507a07de37ef7b40ba

- [x] 先落编辑器/会话边界，锁定共享依赖及项目数据库复用，不重复建表。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-contract.test.ts` → `Tests  4 passed (4)`。
- 严格回放 `pnpm check` → `Test Files  23 passed (23)`，`Tests  337 passed (337)`。
- Electron 正式入口：编辑器和设定集路由均可挂载，后退回编辑器，`1 passed (1.2s)`。未做样式验收。
- Review: skipped — 当前会话无独立审查工具。
- 凭据：[01-editor-contract.txt](../../evidence/m2-editor/01-editor-contract.txt)。
