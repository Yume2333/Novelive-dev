# 02: 定稿剧本语言与解析编译

**Effort:** m1a-project
**Blocked by:** 01
**Covers:** W2
**Files:** packages/format/src/script/, docs/work-format.md, tests/unit/m1a-script.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-script.test.ts` → 解析、编译、往返和错误坐标可验证。

- [ ] 按 handoff 敲定指令、行内标签、推进节奏、参数默认值和诊断码；处理 BOM/CRLF/围栏，稳定场景和句子 ID，验证范围与素材。
