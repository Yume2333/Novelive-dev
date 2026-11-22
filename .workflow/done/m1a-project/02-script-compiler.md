# 02: 定稿剧本语言与解析编译

**Effort:** m1a-project
**Blocked by:** 01
**Covers:** W2
**Files:** packages/format/src/script/, docs/work-format.md, tests/unit/m1a-script.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-script.test.ts` → 解析、编译、往返和错误坐标可验证。
**Base commit:** aafdadd254a04a306f2e8d253df91cc3fc2d6554

- [x] 按 handoff 敲定指令、行内标签、推进节奏、参数默认值和诊断码；处理 BOM/CRLF/围栏，稳定场景和句子 ID，验证范围与素材。

## Progress

- Check before: 基线 `aafdadd` 没有剧本编译入口或指定测试文件。
- Check after: 指定严格回放单测 9 项通过；完整 `pnpm check` 147 项通过。[检查凭据](../../evidence/m1a/02-script-compiler.txt)
- Real path: 在实际磁盘工程编译合成章，写入 2 个场景文件与章索引，关闭后重开，核实场景与句子 ID 和文本往返。[实跑凭据](../../evidence/m1a/02-script-compiler.txt)
- Review: skipped — 当前会话没有可启动的独立审查代理；在 flow-close 补审。
