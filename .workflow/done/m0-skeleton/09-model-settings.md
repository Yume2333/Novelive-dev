# 09: 接线设置页和崩溃横幅

**Effort:** m0-skeleton
**Blocked by:** 04, 05, 07, 08, 12
**Covers:** W2, W5
**Files:** packages/ui/src/pages/settings/, packages/ui/src/shell/, packages/creator/src/entry.ts, tests/e2e/m0-settings.spec.ts
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M0 settings'` → 真实窗口保存设置、显示各模型测试结果、缩略图、取消和重启状态。
**Base commit:** 85f4ce4673d2c12c28a413a7f235ab80bd634b14

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [x] 按原型完成五槽、界面/工程/关于与警告横幅；配置损坏可备份重置。
- [x] 接入模型命令、宿主事件、错误映射和测试状态。
- [x] 设置页的连接测试直接调用 07/08 用于 smoke 录制的适配器入口，不另构造请求。E2E 装载同一份非秘密 smoke 配置，保留相同 method、path 和 canonicalBody；点击真实按钮验证严格命中。成功用例从仓库根解析 `tests/fixtures/text-models/smoke/`、`tests/fixtures/image-models/smoke/`，分进程以 `NL_CASSETTE_DIR` 逐个指定；失败、取消用例同样分别指向 `tests/fixtures/text-models/synthetic/`、`tests/fixtures/image-models/`，不依赖默认目录或 10 的录制。

## Progress

- Check after: 设置页 E2E 6 项、原有 E2E 6 项、单测 123 项通过。[检查日志](../../evidence/m0-skeleton/09-model-settings-check.txt)
- Real path: Electron 开发入口与 Chromium 开发桥严格回放已提交的 smoke，每次只指向对应目录。未产生付费用量。[实际运行输出](../../evidence/m0-skeleton/09-model-settings-real-path.txt) · [亮色设置](../../evidence/m0-skeleton/09-settings-light.png) · [暗色及图片结果](../../evidence/m0-skeleton/09-settings-dark-image.png) · [同尺寸原型](../../evidence/m0-skeleton/09-settings-prototype.png)
- Review: pass (base 85f4ce4673d2c12c28a413a7f235ab80bd634b14, reviewer Devin Review) — [PR #12](https://github.com/Yume2333/Novelive-dev/pull/12) 独立审查通过。
- PR #12 两轮修复后复验：设置页 E2E 7 项、单测 129 项通过。[复验日志](../../evidence/m0-skeleton/09-model-settings-review-check.txt)
