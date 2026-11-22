# 07: 集成播放器并实测 Linux 试安装

**Effort:** m3-playback
**Blocked by:** 02, 03, 04, 05, 06
**Covers:** W1, W2, W3
**Files:** apps/desktop/electron-builder.yml, apps/desktop/package.json, packages/player/src/index.ts, packages/ui/src/pages/player/PlayerPage.tsx, packages/creator/src/pipeline/art/, tests/e2e/m3-gate.spec.ts, .workflow/evidence/m3/
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `pnpm test:e2e --grep 'M3 full playback' && pnpm --filter @novelive/desktop run package:linux` → 播放器端到端通过、实际启动生成的 Linux AppImage 并记录体积和耗时。

- [ ] 完成共享接线与试打包脚本；对照规格测参考机，并记录 GPU/Vulkan 环境、冷/热启动和真实分辨率，不以合成计时替代。
