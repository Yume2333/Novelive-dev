# 01: 固定工程文件与 SQLite 契约

**Effort:** m1a-project
**Blocked by:** None
**Covers:** W1
**Files:** packages/format/package.json, packages/format/src/model/, packages/creator/src/project/, packages/creator/src/contract/project.ts, pnpm-lock.yaml, tests/unit/m1a-project-schema.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-project-schema.test.ts` → 读写真实工程夹与 SQLite、断开重开、六类表及初始记录通过。
**Base commit:** dc177952b64ad4ae5d6f5358296d2dd9132c24b1

- [x] 定义版本、层级、段落、设定集、术语表、资产、任务、用量、会话、提议、历史、运行记录；冻结读写边界供分任务实现。

## Progress

- Check before: 基线 `dc17795` 未包含 `tests/unit/m1a-project-schema.test.ts` 或工程持久化实现。
- Check after: 指定严格回放单测 5 项通过；其余单测 129 项通过，TypeScript 检查通过。[检查凭据](../../evidence/m1a/01-project-schema.txt)
- Real path: 两个独立 CLI 进程创建和重开实际工程目录，核实身份、原文、段落、任务和 SQLite 完整性。单测另往六类表写入记录并重开核实。[实跑凭据](../../evidence/m1a/01-project-schema.txt)
- Review: skipped — 当前会话没有可启动的独立审查代理；在 flow-close 补审。
