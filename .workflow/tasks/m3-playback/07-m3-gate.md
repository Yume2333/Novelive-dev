# 07: 集成播放器并实测 Linux 试安装

**Effort:** m3-playback
**Blocked by:** 02, 03, 04, 05, 06
**Covers:** W1, W2, W3
**Files:** apps/desktop/electron-builder.yml, apps/desktop/package.json, packages/player/src/index.ts, packages/ui/src/pages/player/PlayerPage.tsx, packages/creator/src/pipeline/art/, tests/e2e/m3-gate.spec.ts, .workflow/evidence/m3/
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `pnpm test:e2e --grep 'M3 full playback' && pnpm --filter @novelive/desktop run package:linux` → 播放器端到端通过、实际启动生成的 Linux AppImage 并记录体积和耗时。
**Base commit:** 89c034d741df36205d52404a59b47b61f60e9799
**Status:** active

- [ ] 完成共享接线与试打包脚本；对照规格测参考机，并记录 GPU/Vulkan 环境、冷/热启动和真实分辨率，不以合成计时替代。

## Progress

- 复用实际播放器的快存/普通存读档 UI。真实 Electron 覆盖变速后从当前句首屏重挂、重启重置内存设置、舞台镜头/CG/前景/粒子/遮罩/滤镜恢复；M3 不含音频/BGM，未验证音频快照。用固定工程和严格回放，零付费调用，未遇到缺失 cassette。
- 接入生成图片的后处理档位及 Linux AppImage sidecar 资源。旧基准图无档位记录时沿用原 Lanczos（关闭）处理差分；存量回填由已有 API 和集成测试验证，未新增 UI 入口。
- 实看四类裁切、存档与章末等待截图 `.workflow/evidence/m3/gate-*.png`，重拍并实看 `.workflow/evidence/m3-playback/08-custom-mark-*.png`。
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 full playback'` → `1 passed (31.1s)`；`NL_REPLAY=strict pnpm --filter @novelive/desktop run package:linux` → exit 0；以生成的 AppImage 重走测试 → `1 passed (36.1s)`。环境、首启/重启、实际内容尺寸、安装包差值与侧车输出见 `.workflow/evidence/m3/linux-trial.md`。
- W3 尚未验收：当前仅有 CPU Vulkan，缺少参考机的 1024px→2K 默认档预热 P95 和双次耗时。全量单测在本机有一处 M2 revisions 5 秒超时（644 passed、1 skipped、1 failed）；该文件单独运行 4 项通过。需在 CI 确认。
