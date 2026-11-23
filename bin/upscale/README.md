# 本地放大资源

`manifest.json` 固定 upscayl/upscayl-ncnn `20251207-174704` 的 Linux、Windows、macOS 发布压缩包及其中可执行文件的 SHA-256。程序不入库，开发/构建时运行 `node tools/upscale/fetch.mjs [linux|win32|darwin]`；脚本验证全部模型，再下载并仅解压程序，重复运行会验证并复用本地程序。创作端只通过临时 PNG 文件和 stdio 调用程序，不开启端口。

模型：

- 动漫：`realesrgan-x4plus-anime`，Real-ESRGAN BSD-3-Clause。
- 快速：`realesr-animevideov3-x4`，取 Real-ESRGAN `v0.2.5.0` 的 `realesrgan-ncnn-vulkan-20220424-ubuntu.zip`，BSD-3-Clause；不是 upscayl-lite。
- 保留细节：`4x-NMKD-YandereNeo`，WTFPL；由 OpenModelDB 原始权重转换。manifest 中分别记录原始权重摘要、转换工具版本及转换产物摘要，模型文件 URL 指向其原始来源。

重建保留细节档（在仓库外建立 venv，CPU 即可）：

```sh
python3 -m venv ~/upscale-build/venv
~/upscale-build/venv/bin/pip install torch==2.14.1 torchvision==0.29.2 --index-url https://download.pytorch.org/whl/cpu
~/upscale-build/venv/bin/pip install spandrel==0.4.2 pnnx==20261020
~/upscale-build/venv/bin/python tools/upscale/convert_yandereneo.py
```

脚本先校验 `.pth`，以两组输入尺寸导出动态宽高、fp16 权重，并将 blob 改名为 `data` / `output`。临时原始权重不入库。相关许可全文位于 `licenses/`，含程序 AGPL-3.0、Real-ESRGAN BSD-3、ncnn BSD 和 YandereNeo WTFPL。

后处理档位和回填失败记录存在工程 `candidates/postprocess.json`：与创作专用候选数据一起排除在作品导出之外，也不受可选导出原文 `source/` 的开关影响。`recordProfile` 用于记录新成品；`readProfiles`、`variantProfile` 和 `checkVariantProfile` 用于派生前读取、继承与拒绝不一致档位。`backfill` 可作为后台任务启动，顺序处理、每张保存状态；已有成功记录跳过，失败保留原文件并继续。由调用者统一调度同一工程的写入；本任务不接入 ArtProduction。
