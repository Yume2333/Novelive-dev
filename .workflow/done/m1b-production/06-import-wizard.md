# 06: 接通 TXT 导入核对向导

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W1
**Files:** packages/ui/src/pages/import/, packages/creator/src/import/wizard/, tests/e2e/m1b-wizard.spec.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b TXT wizard'` → 用实际选择文件和工程目录流程导入、修订划分及跳过。
**Base commit:** f1a0090eba860b4f86937b57b09c7ab9f246b4ac

- [x] 涵盖编码歧义、整理建议、分卷可编辑及参考图，读取 M1a 报告。

## Progress

- Check after: 严格回放向导检查 2 项通过；完整检查 216 项通过；Electron 套件 16 项通过。
- Real path: 构建后的 Electron 从书库进入导入页，主进程原生对话框返回合成 TXT、PNG 参考图和工程目录；核对页读取 M1a 导入报告，修订章节与分卷后磁盘工程按修订重写，歧义编码先选 Big5 再跳过核对保持 M1a 划分。
- Evidence: [检查与真实路径](../../evidence/m1b-production/06-import-wizard.txt)。无付费调用；真实无分卷长书的整理角色分卷建议留给主会话录制。
- Review: skipped — 本会话无独立审查会话，由 PR 上的 Devin Review 承担。
