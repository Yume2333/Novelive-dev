# 11: 验收所有者选书的完整制作

**Effort:** m1b-production
**Executor:** spine (paid calls)
**Blocked by:** 09, 10
**Covers:** W4
**Task type:** spike
**Status:** blocked
**Files:** .workflow/evidence/m1b/owner/
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** 仅串行主线执行 `NL_REPLAY=record pnpm dev` → 使用授权真书导入、确认、试玩、继续制作并记录作品验收和用量。并行会话不领取本任务，严格回放不能替代本 Check。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 一个所有者选书完整真跑；将录制目录设在仓库外，不提交原文/请求/私有模型结果。没有资料或余额则记录阻塞，不以合成用例替代。

## Progress

M1a 恢复与综合代码已在 `f9dd863` 合入 main（[#86](https://github.com/Yume2333/Novelive-dev/pull/86)），满足本任务的代码前提。M1a/07 的 0.90 门槛仍未通过，待[所有者评审](../../owner-review.md)，不再付费跑 M1a W4；该比较验收不再是本任务的前置。

获授权的串行窗口已完成 [《浮生六記》制作前探针](../../evidence/m1b/owner/probes.md)，实测 8,818 tokens、1 张图，全部核销。主模型单字段限额 128、供应方报告输出 509；后续保留该主模型并采用 5 倍输出预留、80% 软停止线、每张 7,000 tokens 的生图／编辑估算，不将观察值冒充供应方上界。

Check after: 在 `27ef7dc` 用真实 Electron 完成导入核对。首次窗口因未版本化路径的 HTTP 404 停止，见[检查状态与对账](../../evidence/m1b/owner/live-run-27ef7dc.md)。修正专用配置并通过[离线路径核对和真书续跑](../../evidence/m1b/owner/live-resume-27ef7dc.md)后，七笔后台预览与综合请求均 HTTP 200，核销 149,959 tokens／0 张图，没有新增未核销预留。综合结果已落盘，首卷主视觉确认前界面报「创作端命令失败」，后续步骤未执行。已归还窗口、释放未使用的 1,850,041 tokens／50 张图；验收项未勾选。

## Blocked

先在不调用付费服务的情况下，从已保存的项目和综合结果定位进入首卷视觉确认前的底层错误；确认可继续后再申请新的付费窗口。不得将路由核对或综合结果当作真书 Check 通过。
