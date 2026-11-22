# 01: 固定工程文件与 SQLite 契约

**Effort:** m1a-project
**Blocked by:** None
**Covers:** W1
**Files:** packages/format/package.json, packages/format/src/model/, packages/creator/src/project/, packages/creator/src/contract/project.ts, pnpm-lock.yaml, tests/unit/m1a-project-schema.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-project-schema.test.ts` → 读写真实工程夹与 SQLite、断开重开、六类表及初始记录通过。

- [ ] 定义版本、层级、段落、设定集、术语表、资产、任务、用量、会话、提议、历史、运行记录；冻结读写边界供分任务实现。
