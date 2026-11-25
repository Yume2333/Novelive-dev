# M3 Linux 试安装

- Ubuntu 22.04.5 LTS x86_64，8 个 Intel Xeon vCPU；Vulkan 1.3.204，Mesa 23.2.1、llvmpipe（LLVM 15.0.7，CPU Vulkan，无实体 GPU）。
- Electron 45.4.1，在 Xvfb 1280×1024×24 下运行。播放器测试用 Electron 设置并读取内容尺寸：1280×800、1024×768、960×440、1680×720；截图为实际内容尺寸，不是桌面显示模式。
- `apps/desktop/dist/Novelive-0.0.0.AppImage`：321,630,184 字节（306.73 MiB）；同配置去掉 upscale 资源的基线：298,799,799 字节；净增 22,830,385 字节（21.77 MiB）。三档权重及参数合计 20,331,593 字节（19.39 MiB），包内含 Linux 可执行文件和四份许可。
- 在 `NL_REPLAY=strict` 下直接执行 AppImage，首启至 UI 显示「创作端已就绪」2454 ms，同资料目录重启 2457 ms（未清操作系统页缓存）。同一测试继续完成真实播放器存读档、章节、历史和重启，`1 passed (36.1s)`。
- 用打包目录中的真实 sidecar，以 32×18 PNG 输入运行动漫档并转 WebP：2560×1440 为 6.006 s / 12,730 字节；3840×2160 为 6.570 s / 24,018 字节。此项只验证实际输出尺寸，不能替代 1024px 性能测试。三档 RGB/RGBA、双次与回填由 `tests/integration/m3-upscale.test.ts` 覆盖，与美术单测合跑 `Tests  21 passed (21)`。
- （已被下方 2026-11-25 实测取代）用 fixture PNG 的 1024px 输入、包内同一二进制和权重处理到 2048×2048 WebP：关闭 0.336 s，快速档一次 121.066 s（llvmpipe CPU Vulkan 实测，非参考机结果，保留作历史记录）。当时 CPU Vulkan 未完成默认动漫档预热 P95 和 1024px 双次测量；下方真机数据补齐 W3 指标。

## 2026-11-25 实测（真实 Linux GPU Vulkan 参考机）

- 机器：Fedora Linux 45 Workstation，内核 7.3.3-300.fc45.x86_64，AMD Ryzen 7 8845H（16 线程）/ 30 GiB。`node -v` v24.22.3，pnpm 12.21.0。
- Vulkan 设备（`vulkaninfo --summary`，Instance 1.4.350）：GPU0 `NVIDIA GeForce RTX 4060 Laptop GPU`（DISCRETE，驱动 620.70.06，apiVersion 1.4.357）——本次默认档基准使用；GPU1 `AMD Radeon 780M (RADV PHOENIX)`（Mesa RADV 26.2.6，apiVersion 1.4.354）——可选补测；GPU2 `llvmpipe`（CPU，Mesa 26.2.6）——未用于基准。ncnn `auto` 选 device 0，nvidia-smi 确认进程占用 NVIDIA 显存 ~1090 MiB，非 CPU Vulkan。
- 单 GPU 直跑 1024→4096（realesrgan-x4plus-anime，仅放大段）：`-g 0` 3.91 s / `-g 1` 9.97 s / `-g 2`（llvmpipe）89.29 s，确认默认走独显。
- sidecar `bin/upscale/linux/upscayl-bin` sha256 = `8b0980197d5bdb6fc4fbc0cc50dae721f3df18d91d0d912ec0a3aeea6495367e`，与 `bin/upscale/manifest.json` `platforms.linux.binarySha256` 一致。
- 夹具：确定性生成 1024×1024 RGB PNG（2,153,157 字节，sha256 `bc47debf777daad417d0cab02e4623af7b62269e450d851bb6bda80a052edcab`）。走产品路径 `postprocess()`（spawn upscayl-bin，`-s 4 -j 1:1:1`）后按 `saveWebp()` 同参 `sharp().webp({quality:90})` 编码，`target {width:2048,height:2048}`、`fit:'cover'`，计时段为放大+编码全程。
- 默认动漫档 single → 2048×2048 WebP（RTX 4060，冷 1 + 预热 12 次，每次输出 2048×2048 / 131,398 字节）：cold 6.619 s；warm 逐次 4.304 / 4.359 / 4.079 / 4.863 / 8.405 / 5.695 / 6.643 / 4.430 / 6.806 / 4.673 / 5.974 / 6.033 s。**预热 P50 = 4.863 s，P95 = 8.405 s（≤20 s，达标 ✓）**；最小 4.079，最大 8.405。
- 其它档位（single → 2048×2048 WebP，RTX 4060，1 cold + 3 warm；单位 s）：fast（realesr-animevideov3-x4）cold 4.546 / warm 3.759、3.670、3.692（P50 3.692，P95 3.759，输出 311,212 B）；detail（4x-NMKD-YandereNeo）cold 6.294 / warm 10.711、6.731、5.608（P50 6.731，P95 10.711，输出 261,798 B）；off（Lanczos，不起二进制）cold 0.481 / warm 0.474、0.472、0.465（输出 737,916 B）；double（anime 两次）cold 13.417 / warm 8.498、9.809、7.622（P50 8.498，P95 9.809，输出 141,836 B）。
- 可选 iGPU 补测（780M RADV，直跑二进制仅放大段，1024→4096）：`-g 1` 三次 13.71 / 11.67 / 10.75 s，叠加编码后仍远低于 20 s，明显慢于 RTX 4060 的 3.91 s。
- `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-upscale.test.ts` → `Tests 8 passed (8)`（14.93 s），真实二进制跑 RGB+RGBA 三档、双次与回填。
- e2e fixture 修复：`tests/e2e/m3-gate.spec.ts` 原以 `INSERT INTO work` 未写 `status` 默认 `'queued'`，播放会话打开后 `workQueue.busy=true`，`app.close()` 时 `quit() active()=true` 弹出「制作仍在进行」确认框在 Xvfb 下永久阻塞（120 s 超时）。fixture 改为 seed `status='done'`（该作品两章已由测试写入，无真实在制作内容），修复后 quit 路径 `before-quit → quit() active()=false → cleanup → exit` 正常。无产品代码改动。
- `NL_REPLAY=strict pnpm test:e2e --grep 'M3 full playback'`（隔离 HOME/XDG，Xvfb 1280×1024×24）→ **`1 passed (22.8s)`**；对打包 AppImage 重跑同一 spec（`NL_GATE_APPIMAGE=<AppImage>`）→ **`1 passed (24.4s)`**。
- `NL_REPLAY=strict pnpm --filter @novelive/desktop run package:linux` → exit 0（electron-builder 26.18.0）。`Novelive-0.0.0-linux-x86_64.AppImage` = **522,602,152 字节（498.39 MiB）**；同配置去掉 upscale extraResources 的基线 = 499,720,048 字节（476.57 MiB）；**安装包净增 22,882,100 字节（21.82 MiB，≤40 MiB ✓）**。三档权重及参数合计 20,331,593 字节（**19.39 MiB，≤25 MiB ✓**），sidecar 11,976,752 字节。
- 打包后启动至「创作端已就绪」：`NL_GATE_APPIMAGE` spec 实测 cold 1432 ms / warm 1373 ms；独立 playwright-core 计时脚本（`--appimage-extract-and-run`，同一指标）cold 2618 ms / warm 1365 ms。
- AppImage 由 306.73 MiB 增至 498.39 MiB：`linux-unpacked` 下 `resources/app/node_modules` 达 705,198,288 字节（762M），electron-builder 收集了整个生产依赖树（`@fontsource` 233M、`onnxruntime-node` 88M、`pixi.js` 81M、`lucide-react` 38M、`@img/*` 37M、`pdfjs-dist` 35M、`@napi-rs` 35M、`@novelive/*` 源码 31M、`openai` 29M 等）；渲染端依赖已由 electron-vite 打包进 `out/renderer`，未压缩副本为冗余。属打包结构问题，非 M3 验收指标，记入 closeout 后续事项。
