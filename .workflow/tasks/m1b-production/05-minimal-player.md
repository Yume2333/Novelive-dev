# 05: 交付工程内最小播放器

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2
**Files:** packages/player/src/minimal/, packages/ui/src/pages/player/, tests/e2e/m1b-player.spec.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b minimal player'` → Electron 实际渲染背景/立绘和四类文字并点击推进。
**Base commit:** f1a0090eba860b4f86937b57b09c7ab9f246b4ac
**Status:** active

- [x] 从 format 读剧本编译结果；播放器不依赖创作端；采用已定义的宿主资源适配。

## Progress

- Review check after: 针对 `7b102ca` 的四项审查均属实，逐项独立修复：未就绪或缺失素材延至实际播放时报错；无别名文字显示三级设定集姓名；隐藏槽位优先于同名角色；编译接收作品声明的自定义标记，正文正常显示但不施加效果。`pnpm check` 通过（15 个文件、226 项测试）；严格回放最小播放器 Electron 检查 2 项通过。
- Review real path: 合成工程包含无文件的待绘素材，无引用时正常播放，引用时显示加载错误；验证无别名对话与无立绘心声的姓名、显式别名优先、自定义标记正文，以及 `right` 同名角色保留在左槽、随后按左槽隐藏。无付费调用。
- Review evidence: [完整检查](../../evidence/m1b-production/05-minimal-player-review-check.txt)、[定向 Electron](../../evidence/m1b-production/05-minimal-player-review-e2e.txt)。

- Merge check: 合并 main 后保留播放器与制作界面两侧协议和路由；完整检查 226 项通过。经批准将设置标题定位改为精确匹配，完整 Electron 套件 17 项通过（一次滚动条拖拽偶发失败后原样重跑通过）。[合并检查](../../evidence/m1b-production/05-minimal-player-merge-check.txt)、[合并 Electron](../../evidence/m1b-production/05-minimal-player-merge-e2e.txt)。

- Check after: 说话人设定集审查修复后，`pnpm check` 通过（13 个测试文件、216 项测试）；严格回放最小播放器 Electron 检查 1 项通过，覆盖无立绘素材角色的心声。
- Real path: 从 `/work/:id/play` 选择本地合成工程，经创作端读取首章 `.nvs`、界面端编译；Electron 内 PixiJS 背景/立绘像素匹配，验证对话、心声、旁白、独立字幕与点击推进、隐藏立绘和章末；完整 Electron 套件 15 项通过。
- Evidence: [检查与真实路径](../../evidence/m1b-production/05-minimal-player.txt)、[完整检查](../../evidence/m1b-production/05-minimal-player-check.txt)、[真实路径日志](../../evidence/m1b-production/05-minimal-player-real-path.txt)、[完整 Electron 套件](../../evidence/m1b-production/05-minimal-player-e2e.txt)、[播放器截图](../../evidence/m1b-production/05-minimal-player.png)。无付费调用。
- Review: 主会话指出说话人来源错误，已改为读取系列/卷/作品三级设定集角色 ID 并补回归检查；完整 Electron 套件 15 项通过为修复前记录，修复后按要求重跑完整检查及定向 Electron。按要求保留任务，不归档。
