# Closeout: m3-playback

**Accepted:** 2026-11-24 by agent (omp-vibe-windows)

The owner pre-authorized autonomous delivery; no separate sign-off was sought.

## Shipped

- W1: 完整横屏播放器在真实 Electron 展示镜头、CG、前景、粒子、滤镜/遮罩及文字标签、注音（ruby）、分段变速；四种横屏铺满裁切（16:10、21:9、4:3、phone 比）实看对比原型。CJK 排版按禁则断行、句内三行分页、页首 ruby 不再被裁剪；自定义文本标记在播放与舞台预览渲染整段与逐字样式。
- W2: 导航、快存/普通存读档（60+1 槽）、已读、回滚与前滚分岔、目录重看、制作中章末等待自动载入全部走真实播放器路径；存档回到句首屏，主线不被重看倒退，重启后内存设置重置。
- W3: 本地 ncnn 三档放大（anime / fast / detail）接入生成后处理与 Linux AppImage sidecar（sha256 固定于 `bin/upscale/manifest.json`），支持关闭、单次及双重后处理与存量资产回填；透明 RGBA、WebP、2K/4K 输出经真实二进制验证。权重 19.39 MiB ≤ 25 MiB；安装包净增 21.82 MiB ≤ 40 MiB；参考机（RTX 4060 Laptop，NVIDIA 620.70.06，Vulkan 1.4.357）默认档 1024px→2K 预热 P95 = 8.405 s ≤ 20 s，P50 4.863 s；off/fast/double 与 780M 补测耗时均记录在 `.workflow/evidence/m3/linux-trial.md`。

## Verification

- E2E 门禁 `NL_REPLAY=strict pnpm test:e2e --grep 'M3 full playback'` → `1 passed (22.8s)`（隔离 HOME/XDG，Xvfb 1280×1024×24）；同一 spec 对打包 AppImage 以 `NL_GATE_APPIMAGE` 重跑 → `1 passed (24.4s)`，ready cold 1432 ms / warm 1373 ms。早前 Ubuntu 22.04 llvmpipe 试装 `1 passed (36.1s)`、AppImage 直启 2454/2457 ms 记录保留于 evidence。
- `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-upscale.test.ts` → `Tests 8 passed (8)`（真实二进制，RGB+RGBA 三档、双次、回填）；任务级 e2e/vitest 检查见各归档任务的 Check after。
- 截图证据 `.workflow/evidence/m3/gate-*.png`（四类裁切、存档槽、章末等待）与 `.workflow/evidence/m3-playback/`（文本渲染、控制菜单、自定义标记）均已实看。
- GPU 基准走产品路径 `postprocess()` + `saveWebp()` 同等 WebP 编码，ncnn `auto` 选 device 0（独显），nvidia-smi 实测确认未落 llvmpipe；数据含逐次冷/热耗时，见 `.workflow/evidence/m3/linux-trial.md` 2026-11-25 末节。

## Key decisions & plan changes

- 放大 sidecar 用 upscayl-ncnn 独立可执行（非 Python 包装），manifest 固定三平台压缩包与二进制 SHA-256；`4x-NMKD-YandereNeo` detail 档权重由 `tools/upscale/convert_yandereneo.py` 从 OpenModelDB 原始权重转 fp16 动态宽高，转换与产物摘要均入 manifest。
- 后处理档位与回填记录存 `candidates/postprocess.json`，随创作候选数据排除在作品导出之外；旧基准图无档位记录时沿用原 Lanczos 差分，不新增 UI 入口。
- e2e fixture 修复：`tests/e2e/m3-gate.spec.ts` 的 `INSERT INTO work` 补 `status='done'`。原默认 `'queued'` 使播放会话 `workQueue.busy=true`，退出时 `quit()` 弹「制作仍在进行」确认框在 Xvfb 下永久阻塞 `app.close()`；修复后 quit 路径正常。仅测试 fixture 改动，无产品代码变更。

## Waived checks & skipped reviews

- No spec check was waived. The owner pre-authorized autonomous delivery.
- 任务级独立审查：01、03、04、06 `Review: pass (independent reviewer, 2026-11-24, window 01)`；02、05、08 `Review: skipped`（会话无审查代理，留待收口审查，按 CONVENTIONS §5 在此列出）。03 审查发现并修复了页首 ruby 越界裁剪与页归属断言缺口；04 补齐 `activePerformances` 现场分类端到端断言。
- 07（门禁）`Review: pass (base 1a96966a38334f7031196c9b2f54209ac1f7363c, reviewer w03-reviewer)` — 独立只读审查对照 novelive-finish/integration 差异复核全部证据，无阻断发现。

## Remaining debt & follow-ups

- **AppImage 体积**：本次 498.39 MiB，较上轮 306.73 MiB 增 ~176 MiB。`resources/app/node_modules` 达 705,198,288 B（762M）——electron-builder 收集了 `@novelive/*` 生产依赖全树，其中渲染端依赖（`@fontsource` 233M、`pixi.js` 81M、`lucide-react` 38M、`pdfjs-dist` 35M、`@assistant-ui`、react-dom 等 ≈420M）已打包进 `out/renderer`，未压缩副本为冗余；`@novelive/*` 源码（31M）与 `openai`/`js-tiktoken` 已内联进 `out/main/chunks` 同为冗余。运行真正需要的仅 `sharp`、`onnxruntime-node`、`electron-updater` 及其原生依赖。修正是打包结构调整（收敛 workspace 包 dependencies 声明），建议留给 owner/M5 打包任务。
- 全量单测在本机曾有一处 M2 revisions 5 秒超时（644 passed / 1 skipped / 1 failed），该文件单独运行 4 项通过，待 CI 复核。
- 音频/BGM 不在 M3 范围，音频快照未验证。
