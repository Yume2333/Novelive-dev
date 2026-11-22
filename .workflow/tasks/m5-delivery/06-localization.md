# 06: 交付繁中、英语、日语资源

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W3
**Files:** packages/ui/src/locales/, packages/ui/src/i18n/, tests/unit/m5-locales.test.ts, tests/e2e/m5-locales.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 locales'` → 依次切换四种语言，键完整、插值一致且重要页面可读。

- [ ] 按命名空间扩充翻译，不改变简体中文源文案；记录待人工抽查，保留回退语言。
