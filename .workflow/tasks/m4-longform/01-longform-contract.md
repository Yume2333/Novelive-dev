# 01: 冻结扩展导入与队列边界

**Effort:** m4-longform
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/creator/src/contract/import.ts, packages/creator/src/contract/queue.ts, packages/creator/package.json, pnpm-lock.yaml, tests/unit/m4-import-contract.test.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m4-import-contract.test.ts` → 四种提取器、卷链接以及制作状态与用量 payload 通过契约测试。

- [ ] 先用最小样件选择解析依赖；优先仓库研究片段、标准库和已装依赖，以编码、导航级联、格式元数据、许可和本地解析来验证新增依赖。
