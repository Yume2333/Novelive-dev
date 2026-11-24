# 06: 交付繁中、英语、日语资源

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W3
**Files:** packages/ui/src/locales/, packages/ui/src/i18n/, tests/unit/m5-locales.test.ts, tests/e2e/m5-locales.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 locales'` → 依次切换四种语言，键完整、插值一致且重要页面可读。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [x] 按命名空间扩充翻译，不改变简体中文源文案；记录待人工抽查，保留回退语言。

## Progress

- 界面与主进程（托盘、通知、文件选择器）文案全部经 `t()` / `msg()` 走目录；简体中文原文即键，`packages/ui/src/locales/zh-CN/` 由 `node tools/i18n/locales.ts extract` 从源码生成，改文案后重跑并 `biome check --write`。
- 繁中、英文、日文由 `node tools/i18n/locales.ts translate`（devin-swe-2，只补缺失键，校验插值）生成，待所有者抽查，见 `owner-review.md`。
- 回退：zh-TW → zh-CN，ja → en → zh-CN，en → zh-CN；缺键显示简体中文原文。
- 配置 `language` 扩为四种语言，默认仍为 zh-CN；切换后页面重新挂载，语言存 `config.json` 并缓存到 `localStorage` 以免首屏闪回。
- 后端返回的原始错误信息仍是简体中文，界面只翻译已映射的错误码。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m5-locales.test.ts` → `Test Files 1 passed (1)` / `Tests 6 passed (6)`；`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M5 locales'` → `1 passed (7.0s)`（2026-11-24 于 nl-01 worktree，Node v24.22.3 实跑，真实 Electron 依次切换四种语言通过）。
- Review: pass (independent reviewer, 2026-11-24, window 01) — 独立只读审查核对 i18n 配置、资源索引与单测/e2e；初轮对「回退断言是键回显、不证明回退链生效」存疑，补充证据（zh-TW/en/ja 与 zh-CN 全部命名空间键集合逐一比对完全一致、回退链配置在 `i18n/index.ts:32-36`、e2e 真实切换四语言并断言各语言界面文案与重启持久化）后裁定通过，无存活发现；回退链因全键对齐在运行时不可触发，属防御性兜底。

