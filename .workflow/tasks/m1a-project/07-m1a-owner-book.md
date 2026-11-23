# 07: 验证真卷分块综合和真书工程

**Effort:** m1a-project
**Blocked by:** 06
**Covers:** W4
**Executor:** spine (paid calls)
**Task type:** spike
**Files:** tests/acceptance/m1a-owner-book.test.ts, .workflow/evidence/m1a/owner/
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** 仅串行主线执行 `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1a-owner-book.test.ts` → 按 W4 写脱敏的差异、耗费和重启报告。W4 的比较口径见下文“W4 口径”。并行会话不领取本任务，严格回放不能替代本 Check。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** ea99733e566c72be5873d6507a07de37ef7b40ba
**Status:** blocked

- [ ] 仅使用所有者在 ~/novelive-testbooks/ 放入、且可用中转处理的选书；将录制目录设在仓库外，不提交原文/请求/私有模型结果。没有书则记录阻塞，不暂停后续不依赖真书的建设。

## W4 口径

2026-11-23 起，W4 不再拿单次整卷结果当参照。同一整卷 prompt 重跑三次，两两 F1 只有 0.51／0.60／0.61，temperature 0 + seed 也只有 0.51，所以单次结果本身就不稳定。现在的参照是三次固定整卷结果中至少两次出现的条目；基线是每次整卷对其余两次共识的 F1 平均（留一）。分块对参照的 F1 除以基线须 ≥ 0.90，门槛不降、schema 不放宽。已确认设定零丢失、重启零调用不变。分块过拆分（310 条、169 个不同 ID）仍须修复。固定数据、数值及理由见[比较口径](../../evidence/m1a/owner/w4-metric.md)，严格回放为 `tests/unit/m1a-w4-gate.test.ts`。

## Progress

- 按本轮授权自行选用公版《野叟曝言》，实导入 20 卷／154 回。
- Check after: `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1a-owner-book.test.ts` → `Tests  1 failed (1)`。DeepSeek 禁用探针仍输出推理；已改用 Gemini 完成首卷 7 回预览及卷摘要。第一包综合的初始及修复响应未通过 schema，整卷对照、已确认设定和重启保持未验收。
- 严格 `pnpm check` → `Tests  342 passed (342)`。累计付费 20 次、190,995 tokens、0 张图。
- [脱敏凭据](../../evidence/m1a/owner/receipt.txt)
- 部分交付：schema 契约修复的严格检查为 `Tests  344 passed (344)`。复用首卷预览，第一包综合已保存；第二包修复报 `reasoning_limit`。W4 未通过。
- Check after: `6f47b58` 上运行 `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1a-owner-book.test.ts` → `Tests  1 failed (1)`，两次都停在第二包。分块比较、已确认设定保全与完成后重启零调用未验证；未生成严格回放 fixture。
- 从维基文库 EPUB 重建同一目录版本的公版《野叟曝言》TXT。首卷 7 回正文逐段与网页一致，但新 TXT 的 SHA-256 不等同于旧收据。实际导入 20 卷／154 回；用量与断点见下文。

## Blocked

第二包的同名事件实际含新事实，已改为保留。随后用 `5aba6db` 恢复至第五包，共保存 73 个事件，未进入挑选；验收和零联网重放均报 `reasoning_limit`，无 W4 分数或严格回放 fixture。

第五包 52 个事件共提出 1,443 条补丁，只有 349 个不同 kind/ID。提示原已去重并限字节，但截断后只展示 49 条角色、地点记录，当前包新增的 333 个 kind/ID 只展示 7 个。录制的输入为 3,295–4,296 tokens；最后两次只有推理、没有 JSON。登记表溢出时改用按 kind 分组的去重 ID，同组优先当前包的近期记录；明确在没有新事实时结束，并在只有推理时用聚焦单个未覆盖事件的提示重试一次。保留原包边界、补丁检查和 0.90 门槛。

付费窗口已释放。私有断点和录制均保留；截至此处 W4 实测 1,293,825 tokens、0 张图，另保留 163,854 tokens 未结算。离线用两条录制的推理响应和一条合成结束响应，在断点副本上验证进入第六包；真模型能否完成和通过门槛仍待验收。
