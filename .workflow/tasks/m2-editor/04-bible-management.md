# 04: 实现设定集和术语候选管理

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/creator/src/bible/editing/, packages/ui/src/pages/bible/, tests/e2e/m2-bible.spec.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 bible and glossary'` → 真实界面查看和接受/拒绝候选，不覆盖已确认内容。
**Base commit:** 0bf76ad045f9180ed1683ab7a372974519b557e4
**Status:** active

- [ ] 显示跨章节定位和冲突；对候选应用后传播约定的过期标记。

## Progress

- Plan amended: 首轮真实界面检查暴露异步 `using` 提前关闭工程，已改为等待命令结果；第二轮跨章节断言匹配两个角色，收窄为已展开角色的首个定位。保留原 Check 与完整验收范围，不改规格。
- Verification plan: 固定工程直接构造角色、术语、章节及 proposal/asset 行；真实 Electron 依次查看、接受、拒绝、尝试过期应用，检查数据库、文件及截图；补空设定集与不存在目标的错误路径。
