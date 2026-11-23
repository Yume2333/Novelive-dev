# 02: 实现手工编辑、规则及修改历史

**Effort:** m2-editor
**Blocked by:** 01
**Covers:** W1, W3
**Files:** packages/creator/src/editor/history/, packages/creator/src/editor/rules/, packages/format/src/script/editing/, tests/unit/m2-history.test.ts
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-history.test.ts` → 真实工程中 ID 稳定、修改可审计、撤销范围和章规则优先正确。
**Base commit:** 0bf76ad045f9180ed1683ab7a372974519b557e4

- [x] 支持文本/标记、表情和规则；重开只读持久历史，按版本核验写前输入。

## Progress

- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-history.test.ts` → 1 个测试文件、7 个测试通过，见 `.workflow/evidence/m2-editor/02-edit-history.txt`。
- 审查回归：`@move` 后仍编辑原槽位；目标句后恢复原表情，同场后续句和相邻场景不继承编辑。
- Review: blocked (base 0bf76ad045f9180ed1683ab7a372974519b557e4) — 单句表情影响后续句；已修复，待独立复核。
- 真实服务路径：用 `Project.create/open` 建立并重开磁盘工程，核对 .nvs、work.json、project.db 审计及会话级撤销；Electron 与调度接线留给后续任务。
- 未调用模型，无需新增 cassette。
