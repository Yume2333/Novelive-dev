# 05: 交付工程内最小播放器

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W2
**Files:** packages/player/src/minimal/, packages/ui/src/pages/player/, tests/e2e/m1b-player.spec.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b minimal player'` → Electron 实际渲染背景/立绘和四类文字并点击推进。

- [ ] 从 format 读剧本编译结果；播放器不依赖创作端；采用已定义的宿主资源适配。
