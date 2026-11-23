# 08: 验收编辑与对话的组合流程

**Effort:** m2-editor
**Blocked by:** 04, 05, 06, 07
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/ui/src/App.tsx, packages/ui/src/shell/, tests/e2e/m2-gate.spec.ts, .workflow/evidence/m2/
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 revise a work'` → 真实 Electron 从脚本定位原文，分别经两个入口重写，重开验证持久记录。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [x] 接线并比对原型，CJK 文本效果和最小播放器预览保留；严格回放，不新增付费调用。

## Progress

- PR #57 第三轮：确认起始 HEAD 5bbcdab；H 保留重绘完成/失败状态到 aria-busy 解除后，I 用 renderer 实际 decode 的图片 URL/hash 校验单张替换与候选采用，跳过 UI 缓存刷新会使测试失败。兼容 main 新文本渲染器的隐藏测量副本，精确断言可见 innerText。严格 check → 43 files / 563 passed / 1 skipped；严格门禁 → 1 passed (14.5s)，更新截图和 receipt。无新增录制或付费调用。

- PR #57 第二轮：确认起始 HEAD 为 c905614；修复图片替换清空文本撤销、图片 ID 子串匹配、手动还原草稿后无法刷新、生产 Agent 位置 prompt；补齐重绘 spinner 与独立 replay filter 回归。用户授权后仅录制一次且成功：2 次 gemini-3.8-flash，3011 input / 631 output / 3642 total；复用 writer 与图片 cassette，不再付费。已更新两份私有账本并审查提交 cassette。严格 check → 43 files / 563 passed / 1 skipped；严格 M2 gate + editor → 10 passed (20.7s)，刷新 M2 截图。原生 select 是现有生产控件模式且已用 Tokens 样式，无现成自定义生产下拉，保留。详见 receipt 第二轮记录。

- 按交接合并 `origin/main`（`f65bf0b`），保留两侧 replay 失败过滤选项并新增组合回归；队列/托盘退出行为沿用 main，门禁将手工发布的 fixture 标为 done，仍真实退出重开，不绕过生命周期。安装新增依赖及本机 Vulkan runtime 后，`NL_REPLAY=strict pnpm check` → 42 files / 560 passed / 1 skipped；完整严格门禁 → 1 passed (13.1s)。没有重录 cassette 或新增付费调用。
- PR #57 审查回归：保留 Agent 更新前的未保存编辑，重开 Agent 恢复已确认差异；首章重做仍保留后续章确认门禁；兼容紧凑 NVS 行格式。CI smoke 纳入本门禁，补齐编辑器单张重绘、缓存候选图及选择入口，仅用既有 m2-revisions cassette；代码块用 Tokens / CJK mono / 自动换行，更新 `04-agent-cjk-confirm.png`，新增 `07-image-redrawn.png`。严格门禁 1 passed (9.3s)，check 为 29 files / 397 tests，既有 editor / chat / routes 为 12 passed。**仍需授权：** 当前 editor position 未进入模型 prompt，已用假 upstream 复现；修正会改变已录制请求 hash，本轮未改 prompt、未重新录制、未新增付费调用。详见 receipt 的逐项记录。
- 已完成真实 Electron 门禁。默认 `tests/fixtures/cassettes/m2-gate/` 含三份已审查响应；无需 secrets 或 `NL_CHAT_CASSETTE_DIR`，`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'` → **1 passed (5.6s)**。原文定位、最小预览、编辑入口只应用勾选差异、Agent 加载、中文代码块及确认按钮、Agent 确认后选择性应用、重开后的剧本与历史记录全部通过。
- editor / Agent 共用生产会话的 `CreativeRevisions`，候选图复制到应用缓存，编辑器随 Agent 应用刷新。当前后端始终返回空 `markSuggestions`；注册的 `resolveMark` 校验版本后对不存在的建议返回 `not_found`，不新增建议生产器。
- 用户随后明确授权本会话绑定 `NL_IMAGE_BASE_URL` / `NL_IMAGE_API_KEY` 录制，并提交隐私审查后的 cassette。实际 **4 次** `gemini-3.8-flash` 请求尝试：3 次完成（提议、writing、续答），1 次 writing 因测试旧 5 秒超时被取消，未返回用量。完成请求合计 **3222 input / 1129 output / 4351 tokens**；取消请求实际 input/output 未知，1024 输出预留不冒充实际用量。私有账本 `$HOME/novelive-private/usage.csv` 与 `$HOME/memory/poke_5b9601/files/novelive/usage.csv` 均已记录四次尝试；不提交账本、原始日志或 secrets。
- 录制因真实测试失败续跑：修正同时匹配工具详情的代码块定位器，将模型等待与已有 90 秒模型超时对齐；录制恢复时复用已成功响应，避免重复付费。初次编辑器重写仍复用 M2/07 的既有离线 cassette。后续截图和验证均严格离线。
- 隐私审查解码了三份 SSE 及元数据：只含 `content-type` 响应头和 `/v1/chat/completions` 路径，无 key、auth header、relay host/URL、绝对 home 路径。录制与配置说明在 `tests/fixtures/cassettes/m2-gate/README.md`。
- `NL_REPLAY=strict pnpm check` → **29 files / 394 tests passed**，覆盖 typecheck / lint / unit；既有 editor / chat / routes Electron 结果为 12 passed。完整检查输出和用量明细见 `.workflow/evidence/m2/receipt.md`；新增中文确认卡、Agent 勾选差异、应用后和重开截图，保留最小播放器与自定义滚动条。
