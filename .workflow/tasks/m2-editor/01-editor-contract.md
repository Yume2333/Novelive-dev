# 01: 冻结编辑、重写及会话契约

**Effort:** m2-editor
**Blocked by:** None
**Covers:** W1, W2, W3
**Files:** packages/creator/src/contract/editor.ts, packages/creator/src/contract/chat.ts, packages/ui/package.json, pnpm-lock.yaml, tests/unit/m2-contract.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-contract.test.ts` → 命令请求、旧值版本和提议载荷校验通过。

- [ ] 先落编辑器/会话边界，锁定共享依赖及项目数据库复用，不重复建表。
