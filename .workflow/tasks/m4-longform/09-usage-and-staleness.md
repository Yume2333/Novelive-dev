# 09: 交付用量和过期提示

**Effort:** m4-longform
**Blocked by:** 01
**Covers:** W2, W3
**Files:** packages/creator/src/usage/, packages/creator/src/bible/staleness/, packages/ui/src/pages/usage/, tests/e2e/m4-usage.spec.ts
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 usage and stale assets'` → 真实面板展示已发生用量，编辑设定引发正确过期投影。

- [ ] 用量只作参考，不引入产品预算停机；按交接默认传播范围，风格改动只提示。
