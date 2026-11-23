# M3 Linux 试安装

- Ubuntu 22.04.5 LTS x86_64，8 个 Intel Xeon vCPU；Vulkan 1.3.204，Mesa 23.2.1、llvmpipe（LLVM 15.0.7，CPU Vulkan，无实体 GPU）。
- Electron 45.4.1，在 Xvfb 1280×1024×24 下运行。播放器测试用 Electron 设置并读取内容尺寸：1280×800、1024×768、960×440、1680×720；截图为实际内容尺寸，不是桌面显示模式。
- `apps/desktop/dist/Novelive-0.0.0.AppImage`：321,630,184 字节（306.73 MiB）；同配置去掉 upscale 资源的基线：298,799,799 字节；净增 22,830,385 字节（21.77 MiB）。三档权重及参数合计 20,331,593 字节（19.39 MiB），包内含 Linux 可执行文件和四份许可。
- 在 `NL_REPLAY=strict` 下直接执行 AppImage，首启至 UI 显示「创作端已就绪」2454 ms，同资料目录重启 2457 ms（未清操作系统页缓存）。同一测试继续完成真实播放器存读档、章节、历史和重启，`1 passed (36.1s)`。
- 用打包目录中的真实 sidecar，以 32×18 PNG 输入运行动漫档并转 WebP：2560×1440 为 6.006 s / 12,730 字节；3840×2160 为 6.570 s / 24,018 字节。此项只验证实际输出尺寸，不能替代 1024px 性能测试。三档 RGB/RGBA、双次与回填由 `tests/integration/m3-upscale.test.ts` 覆盖，与美术单测合跑 `Tests  21 passed (21)`。
- 用 fixture PNG 的 1024px 输入、包内同一二进制和权重处理到 2048×2048 WebP：关闭 0.336 s，快速档一次 121.066 s。CPU Vulkan 未完成默认动漫档预热 P95 和 1024px 双次测量；不以小图耗时替代。W3 的 20 秒指标仍需在 Linux Vulkan 参考机实测。
