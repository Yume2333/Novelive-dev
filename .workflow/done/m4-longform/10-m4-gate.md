# 10: 贯通扩展格式、队列与宿主

**Effort:** m4-longform
**Blocked by:** 02, 03, 04, 05, 06, 07, 08, 09
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/creator/src/import/wizard/, packages/ui/src/pages/import/, apps/desktop/src/main/index.ts, tests/e2e/m4-gate.spec.ts, .workflow/evidence/m4/
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 longform and queue'` → 从五种格式走真实导入，跨卷与跨作品生产，通知及恢复可观察。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。
**Base commit:** ce09ca4bff51b1093dc37854ddda795e49348cb1

- [x] 通过严格回放比较真实流程并截图；只有授权样本和预算可用时跑限定章节做跨语种/插图抽查。

## Progress

- Check after: `NL_REPLAY=strict xvfb-run -a pnpm exec playwright test --grep 'M4 longform and queue'` → 4 passed；同一构建全量 Electron E2E（`--workers=1`）→ 59 passed；`pnpm check` → 51 files / 669 passed, 1 skipped。见 `.workflow/evidence/m4-longform/gate-resume.txt`（代码 `8db0406`）。
- 本轮：关闭时取消并等待生产任务；首卷出图失败会解除后卷等待并允许重新打开；保存设置不等待主视觉确认；后卷画师实际发送已批准主视觉。真实 Electron 验证双向重排、外部参考图与 EPUB 内嵌图合计上限、所选 EPUB 图实际保存。
- 证据：`gate-*.png`、上一轮 `gate.txt`。生产用量来自严格回放；29 条公开合成 cassette 位于 `tests/fixtures/cassettes/m4-gate/`，本轮无付费调用。
- UUID 响应重绑定为显式回放选项；生产 cassette 目录沿用严格回放延迟/故障选项。已有回放默认响应不变。
- 所有者授权的最小付费抽查已完成：真实 writeChapter / devin-swe-2 一次，输入 702、输出 118 tokens，简体中文且 NVS 编译通过；有超出原句的氛围描写，非忠实度完整验收。真实 classifyIllustrations / gemini-3.8-flash 一次，输入 1228、输出 218 tokens，照片参考合理归为 character 且保持未选中。共 2266 tokens、0 生图，无 fallback 调用。私有 cassette 留在仓库外，usage.csv 已追加两行；公开脱敏凭证见 `.workflow/evidence/m4-longform/spot-check.txt`。
- 无头宿主检查控制托盘 watcher 可用性并截获原生通知 show；原生托盘点击处理、窗口状态、IPC 与 creator 均为真实路径。未验收 OS 通知气泡或授权原文的广泛跨语种/插图质量；本次真模型仅抽查公开微型夹具，里程碑独立验收仍待进行。
- Review: pass (base ce09ca4bff51b1093dc37854ddda795e49348cb1, reviewer Devin Review)
- [PR #66](https://github.com/Yume2333/Novelive-dev/pull/66) 于 `e9616cd` 合并；最终审查无新增可执行问题。`a7ce916` 修复退出中断导入的回滚、DOCX 扉页封面和暂停续卷的预处理，并验证原生退出后重开、续做并发布首章；`af1305c` 阻止后卷越过缺少摘要的暂停前卷，并验证第二条作品绑定失败时一并回滚工程和第一条绑定。
- `deafccc`：全局队列显示须先继续的前卷标题，真实 Electron 验证被拒的后卷仍暂停。
- `8db0406`：全局队列保留前卷标题提示；缺失模型名时，真实 Electron 验证显示中文设置指引。
