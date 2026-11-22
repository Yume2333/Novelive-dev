# 07: 接通作品包导入、导出和文件关联

**Effort:** m5-delivery
**Blocked by:** 02, 03, 04, 05
**Covers:** W1, W2
**Files:** packages/creator/src/share/, packages/creator/src/entry.ts, packages/ui/src/App.tsx, apps/desktop/src/main/file-association/, apps/desktop/electron-builder.yml, tests/e2e/m5-share.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 share and play offline'` → 不同应用数据目录执行导出→双击导入→离线播放→更新→导入为工程。

- [ ] 替换旧包到回收站，验证包资源协议与无模型播放器；将作品导入为新工程后再导出新身份。
