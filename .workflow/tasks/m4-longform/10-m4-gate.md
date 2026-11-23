# 10: 贯通扩展格式、队列与宿主

**Effort:** m4-longform
**Blocked by:** 02, 03, 04, 05, 06, 07, 08, 09
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/creator/src/import/wizard/, packages/ui/src/pages/import/, apps/desktop/src/main/index.ts, tests/e2e/m4-gate.spec.ts, .workflow/evidence/m4/
**Read first:** `.workflow/specs/m4-longform.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M4 longform and queue'` → 从五种格式走真实导入，跨卷与跨作品生产，通知及恢复可观察。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [x] 通过严格回放比较真实流程并截图；只有授权样本和预算可用时跑限定章节做跨语种/插图抽查。

## Progress

- 验证：`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M4 longform and queue'` → 3 passed。W1 五格式导入；W2 两个工程、加入第二卷、队列让位/重排、真实 creator SIGKILL 后暂停及显式续作；W3 真实游玩等待事件、后台新章/完成通知定位、托盘/无托盘、第二实例与空闲休眠阻止清理。
- 证据：`.workflow/evidence/m4-longform/gate.txt`、`gate-*.png`。用量来自实际生产请求的严格回放；29 条公开合成 cassette 位于 `tests/fixtures/cassettes/m4-gate/`，覆盖普通 `devin-swe-2` 第二章写作，无付费调用。
- UUID 响应重绑定为显式回放选项；生产 cassette 目录沿用严格回放延迟/故障选项。已有回放默认响应不变。
- 回归：`NL_REPLAY=strict pnpm test` → 49 files / 625 passed, 1 skipped；安装环境所缺的 `mesa-vulkan-drivers` 后真实放大二进制通过。补齐 creation-ui projection 的队列命令、限定 M1b 的可见文字定位器后，完整 `NL_REPLAY=strict xvfb-run -a pnpm test:e2e` → 57 passed。独立 worktree 的当前 origin/main `3ffefd6` 已有限定定位器，M1b 1 passed；本分支采用同样的纯测试修复后 M1b 1 passed，无产品改动。
- 所有者授权的最小付费抽查已完成：真实 writeChapter / devin-swe-2 一次，输入 702、输出 118 tokens，简体中文且 NVS 编译通过；有超出原句的氛围描写，非忠实度完整验收。真实 classifyIllustrations / gemini-3.8-flash 一次，输入 1228、输出 218 tokens，照片参考合理归为 character 且保持未选中。共 2266 tokens、0 生图，无 fallback 调用。私有 cassette 留在仓库外，usage.csv 已追加两行；公开脱敏凭证见 `.workflow/evidence/m4-longform/spot-check.txt`。
- 无头宿主检查控制托盘 watcher 可用性并截获原生通知 show；原生托盘点击处理、窗口状态、IPC 与 creator 均为真实路径。未验收 OS 通知气泡或授权原文的广泛跨语种/插图质量；本次真模型仅抽查公开微型夹具，里程碑独立验收仍待进行。
