# 05: 交付工程内最小播放器

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2
**Files:** packages/player/src/minimal/, packages/ui/src/pages/player/, tests/e2e/m1b-player.spec.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b minimal player'` → Electron 实际渲染背景/立绘和四类文字并点击推进。
**Base commit:** f1a0090eba860b4f86937b57b09c7ab9f246b4ac

- [x] 从 format 读剧本编译结果；播放器不依赖创作端；采用已定义的宿主资源适配。

## Progress

- Check after: 合并 `origin/main`（`14b2cdb`）无冲突，保留播放器、调度器与导入向导行为；`pnpm check` 通过（17 个文件、239 项测试），`NL_REPLAY=strict xvfb-run -a pnpm test:e2e` 完整 Electron 套件 20 项通过，包含最小播放器检查 2 项。
- Real path: 构建后的 Electron 从 `/work/:id/play` 选择本地合成工程，读取首章并编译；验证背景/立绘像素、四类文字、点击推进与章末。无别名对话及无立绘心声显示设定集姓名，显式别名优先，自定义标记正文不施加效果；`@hide right` 不隐藏左槽中同名角色；未引用的待绘素材不阻断播放，实际引用缺失素材时显示错误。严格回放，无付费调用。
- Evidence: [最终完整检查](../../evidence/m1b-production/05-minimal-player-final-check.txt)、[最终完整 Electron 输出](../../evidence/m1b-production/05-minimal-player-final-e2e.txt)、[播放器截图](../../evidence/m1b-production/05-minimal-player.png)、[首轮修复检查](../../evidence/m1b-production/05-minimal-player-review-check.txt)、[首轮修复真实路径](../../evidence/m1b-production/05-minimal-player-review-e2e.txt)。
- Review: pass (base 93e3e53733a41da539c903200f328fca1678f829, reviewer Devin Review) 第一轮 4 项已修复（`48f1849`、`f42f2d1`、`97d3590`、`93e3e53`），第二轮 0 项；第二轮结果由主会话确认。最新 main 合并后完整检查与真实路径均通过。
