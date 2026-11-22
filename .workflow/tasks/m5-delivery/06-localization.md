# 06: 交付繁中、英语、日语资源

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W3
**Files:** packages/ui/src/locales/, packages/ui/src/i18n/, tests/unit/m5-locales.test.ts, tests/e2e/m5-locales.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 locales'` → 依次切换四种语言，键完整、插值一致且重要页面可读。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 按命名空间扩充翻译，不改变简体中文源文案；记录待人工抽查，保留回退语言。
