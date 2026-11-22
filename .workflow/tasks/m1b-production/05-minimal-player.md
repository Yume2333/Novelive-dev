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

- Check after: 说话人设定集审查修复后，`pnpm check` 通过（13 个测试文件、216 项测试）；严格回放最小播放器 Electron 检查 1 项通过，覆盖无立绘素材角色的心声。
- Real path: 从 `/work/:id/play` 选择本地合成工程，经创作端读取首章 `.nvs`、界面端编译；Electron 内 PixiJS 背景/立绘像素匹配，验证对话、心声、旁白、独立字幕与点击推进、隐藏立绘和章末；完整 Electron 套件 15 项通过。
- Evidence: [检查与真实路径](../../evidence/m1b-production/05-minimal-player.txt)、[完整检查](../../evidence/m1b-production/05-minimal-player-check.txt)、[真实路径日志](../../evidence/m1b-production/05-minimal-player-real-path.txt)、[完整 Electron 套件](../../evidence/m1b-production/05-minimal-player-e2e.txt)、[播放器截图](../../evidence/m1b-production/05-minimal-player.png)。无付费调用。
- Review: 主会话指出说话人来源错误，已改为读取系列/卷/作品三级设定集角色 ID 并补回归检查；完整 Electron 套件 15 项通过为修复前记录，修复后按要求重跑完整检查及定向 Electron。按要求保留任务，不归档。
