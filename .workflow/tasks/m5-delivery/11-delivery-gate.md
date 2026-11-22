# 11: 复核三平台产物和产品真实流程

**Effort:** m5-delivery
**Blocked by:** 08, 09, 10
**Covers:** W1, W2, W3
**Files:** tests/e2e/m5-delivery.spec.ts, .workflow/evidence/m5/closeout/, .workflow/owner-review.md
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `pnpm check && NL_REPLAY=strict pnpm test:e2e --grep 'M5 full delivery'` → 全链路与离线回归通过，各原生平台安装、导入、游玩、卸载另有回执。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 汇总三个原生平台的安装回执，校验产物版本、校验和与下载位置；完整功能验收含两次确认、编辑、分享、更新；记录未签名和待抽查事项。
