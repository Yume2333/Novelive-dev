# 02: 实现作品包流式读写与格式迁移

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/format/src/package/codec/, packages/format/src/package/migrations/, tests/fixtures/work-packages/, tests/integration/m5-archive.test.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-archive.test.ts` → 实际 ZIP 条目顺序、压缩、路径、版本与错误可验证。
**Base commit:** e10725ed62a8c41308a373b35d1a7fc6d92aa5cb
**Status:** active

- [ ] 支持一卷/系列继承归档；拒坏包、危险路径和过新版本，已有版本未知字段放行，默认剔除私有文件。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-archive.test.ts` → 34 项通过；使用实际 ZIP 文件验证导出、索引读取和解包，未调用付费接口。
- 接线：`@novelive/format/package/codec` 提供 `exportPackage`、`openPackage`、条目流和新目录解包。导出仅写归档，不改工程；共享接线在成功后持久化返回的作品版本。
