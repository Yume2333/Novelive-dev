# 07: 集成播放器并实测 Linux 试安装

**Effort:** m3-playback
**Blocked by:** 02, 03, 04, 05, 06
**Covers:** W1, W2, W3
**Files:** apps/desktop/electron-builder.yml, apps/desktop/package.json, packages/player/src/index.ts, packages/ui/src/pages/player/PlayerPage.tsx, packages/creator/src/pipeline/art/, tests/e2e/m3-gate.spec.ts, .workflow/evidence/m3/
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `pnpm test:e2e --grep 'M3 full playback' && pnpm --filter @novelive/desktop run package:linux` → 播放器端到端通过、实际启动生成的 Linux AppImage 并记录体积和耗时。
**Base commit:** 89c034d741df36205d52404a59b47b61f60e9799

- [x] 完成共享接线与试打包脚本；对照规格测参考机，并记录 GPU/Vulkan 环境、冷/热启动和真实分辨率，不以合成计时替代。

## Progress

- 复用实际播放器的快存/普通存读档 UI。真实 Electron 覆盖变速后从当前句首屏重挂、重启重置内存设置、舞台镜头/CG/前景/粒子/遮罩/滤镜恢复；M3 不含音频/BGM，未验证音频快照。用固定工程和严格回放，零付费调用，未遇到缺失 cassette。
- 接入生成图片的后处理档位及 Linux AppImage sidecar 资源。旧基准图无档位记录时沿用原 Lanczos（关闭）处理差分；存量回填由已有 API 和集成测试验证，未新增 UI 入口。
- 实看四类裁切、存档与章末等待截图 `.workflow/evidence/m3/gate-*.png`，重拍并实看 `.workflow/evidence/m3-playback/08-custom-mark-*.png`。
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 full playback'` → `1 passed (31.1s)`；`NL_REPLAY=strict pnpm --filter @novelive/desktop run package:linux` → exit 0；以生成的 AppImage 重走测试 → `1 passed (36.1s)`。环境、首启/重启、实际内容尺寸、安装包差值与侧车输出见 `.workflow/evidence/m3/linux-trial.md`。
- Check after（2026-11-25 真机补测）：Fedora 45 / Ryzen 7 8845H / RTX 4060 Laptop（NVIDIA 620.70.06，Vulkan 1.4.357），1024px→2K 默认动漫档预热 P95 = 8.405 s（≤20 s ✓），P50 4.863 s；fast/detail/off/double 及 780M 补测、sidecar sha256 与 manifest 一致、集成测试 8/8 见 `.workflow/evidence/m3/linux-trial.md` 末节。
- e2e 修复：`tests/e2e/m3-gate.spec.ts` fixture 的 `INSERT INTO work` 补 `status='done'`，消除退出时「制作仍在进行」确认框在 Xvfb 下的 `app.close()` 挂起；修复后 `NL_REPLAY=strict pnpm test:e2e --grep 'M3 full playback'` → `1 passed (22.8s)`，对重建 AppImage 以 `NL_GATE_APPIMAGE` 重跑 → `1 passed (24.4s)`（spec 打印 ready cold 1432 ms / warm 1373 ms）。
- Check after（终态）：`NL_REPLAY=strict pnpm --filter @novelive/desktop run package:linux` → exit 0；AppImage 522,602,152 B（498.39 MiB），较同配置去 upscale 资源基线净增 22,882,100 B（21.82 MiB，≤40 MiB ✓）；权重 19.39 MiB（≤25 MiB ✓）。W3 全部指标达标。已知余留：AppImage 较上轮 306.73 MiB 增大系 electron-builder 依赖收集使 `resources/app/node_modules` 达 705 MiB（渲染端依赖冗余），记入 closeout 后续事项；本机全量单测曾有一处 M2 revisions 5 秒超时（单跑通过），待 CI 复核。
- Review: pass (base 1a96966a38334f7031196c9b2f54209ac1f7363c, reviewer w03-reviewer) — 独立只读审查对照 novelive-finish/integration 全量差异复核 W1–W3 证据与 linux-trial 实测数据，无阻断发现。
