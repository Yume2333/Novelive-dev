# 10: 录制并脱敏真实模型验收

**Effort:** m0-skeleton
**Blocked by:** 06, 09
**Covers:** W3
**Files:** tests/fixtures/cassettes/, .workflow/evidence/m0/live/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=record pnpm dev` → 按 W3 逐个操作三文本协议和三图片能力；保存脱敏回放及截图。

- [ ] 守用量计划，由单一执行者使用私有 relay；覆盖 auth 与 moderation（没有原生 moderation 时用规格允许的等价注入）。
- [ ] 退出重开检查配置；回放不含授权头、中转地址或真实私有输入。
