# spikes-r4/upscale：放大模型对比 + 多次放大（双重放大降噪）

问题：现在默认用 `realesrgan-x4plus-anime`（= Upscayl `digital-art-4x`），有没有更新、更好、能随包带的模型；
「双重放大降噪」（放大 → 缩回原尺寸 → 再放大）是否真的更好。

## 输入

全是真实中转出图（sunburst，high）：

- `W`：round5 `W--ref--r2`，1536x864 暖色 CG → 2560x1440
- `T3`：round3 `T3--FXB--sunburst`，1536x1024 茶会 CG → 2560x1707
- `T1`：round3 `T1--FXB--sunburst`，1024x1536 透明立绘 → 2048x3072

## 跑法

- `src/sr.py <model,...> [W,T3,T1] [passes]`：每个模型跑 3 遍。第 k 遍 = 模型原生倍率放大，
  最后一遍 Lanczos 到目标尺寸，中间遍 Lanczos 缩回原尺寸再喂下一遍。p1 = 放大降噪，p2 = 双重放大降噪，p3 看趋势。
  后端：torch（spandrel，RTX 4060，能 fp16 就 fp16，否则 fp32；bf16 会让 DySample 模型出马赛克，弃用）、
  `upscayl-bin`（我们要随包的 ncnn 程序）、waifu2x（nunif torch.hub）。RGBA 的透明通道复制成三通道过同一模型。
- `src/contact.py [model,...]`：`contact/<图>-c{0,1}-p1.png`（各模型 p1，100% 裁切）、
  `contact/<图>-c{0,1}-passes.png`（p1/p2/p3）、`contact/metrics.tsv`。
- 环境：`uv venv -p 3.12 .venv` + torch cu128/cu132、spandrel、spandrel_extra_arches、pnnx；
  `bin/upscayl-bin` = upscayl-ncnn release 20251207-174704；权重来源见 `src/sr.py` 的 `MODELS` 表。

指标（都相对「后处理关」= Lanczos 直接放到目标尺寸）：

- `back_psnr`：输出缩回原尺寸和原图比，越高越忠实
- `sharp`：平均梯度 / Lanczos 的平均梯度
- `flat_noise`：平涂区高频残差标准差，越低越干净
- `red_fringe`：线稿边缘像素里「红色突然变深 > 30」的比例，量 ESRGAN-anime 画出来的红边

## 结果（p1）

| 模型 | 许可 | 4060 秒/张（CG / 立绘） | W back_psnr / 红边% | T3 | T1 |
|------|------|------|------|------|------|
| `digital-art-4x`（现默认，ncnn） | BSD-3 | 8.8 / 8.7 | 34.5 / 5.19 | 32.0 / 2.63 | 35.1 / 3.41 |
| `realesr-animevideov3-x4`（现快速档，ncnn） | BSD-3 | 4.9 / 6.8 | 36.2 / 0.21 | 34.4 / 0.06 | 38.3 / 0.04 |
| 4x-NMKD-YandereNeo（ESRGAN 2021） | WTFPL | 3.5 / 8.5 | 43.8 / 0.00 | 39.9 / 0.00 | 41.0 / 0.00 |
| waifu2x swin_unet art（nunif） | MIT | 1.8 / 3.6 | 55.0 / 0.00 | 51.9 / 0.00 | 46.3 / 0.00 |
| 4xHFA2k RealPLKSR-DySample（2024） | CC-BY-4.0 | 6.1 / 11.5 | 36.3 / 0.04 | 33.2 / 0.05 | 31.3 / 0.20 |
| 2x-ModernSpanimationV1（2024） | MIT | 0.7 / 1.1 | 34.8 / 0.00 | 33.3 / 0.01 | 36.9 / 0.13 |
| APISR RRDB / GRL / DAT（CVPR24） | GPL-3.0 | 3–49 / 8–104 | 27–30 / 11–14 | 23–27 / 5–8 | 27–31 / 7–10 |
| IllustrationJaNai V3 detail / denoise（DAT2 2025-11） | CC-BY-NC-4.0 | 48–67 / 113–156 | 45.7 / 0.00 | 50 / 0.00 | 45 / 0.00 |
| 4x-UltraSharpV2（DAT2 2025-05） | CC-BY-NC-SA-4.0 | 52 / 125 | 38.6 / 0.15 | 43.1 / 0.00 | 42.3 / 0.00 |
| 2x-AnimeSharpV4（RCAN 2025-01） | CC-BY-NC-SA-4.0 | 9 / 26 | 46.4 / 0.00 | 52.4 / 0.00 | 49.0 / 0.00 |

DAT2/RCAN 行是 fp32 + tile 192（8GB 显存 fp32 放不下 512 的块），只当画质参照：许可是 NC，不能随包。

目测（`contact/*-p1.png`）：

- `digital-art-4x` 是这批里改画最狠的：嘴线、发丝边描成红线，眼睛描深。gpt-image 输出本来就干净，没有它训练时假设的 JPEG/噪声退化，它的「去噪」只剩重描。
- APISR 三个更狠：加粗黑线、换画风，不可用。
- YandereNeo、AnimeSharpV4、JaNai V3、UltraSharpV2 都是「放大但不改画」：线条变干净、没有红边、颜色不变。
  AnimeSharpV4 / JaNai V3 最好，但 NC 许可且 DAT2 太慢（4060 上一张立绘 2 分钟，核显不可能）。
- waifu2x art 几乎等于 Lanczos 加轻微锐化，最忠实也最软。
- `realesr-animevideov3` 偏软，CG 整体提亮约 2 级。

## 多次放大（p1 → p2 → p3，`contact/*-passes.png`）

| 模型 | W 红边% p1/p2/p3 | T1 红边% | W back_psnr p1/p2/p3 |
|------|------|------|------|
| `digital-art-4x` | 5.2 / 12.7 / 17.8 | 3.4 / 8.7 / 12.7 | 34.5 / 30.5 / 28.1 |
| `realesr-animevideov3` | 0.2 / 1.8 / 3.9 | 0.0 / 0.9 / 3.1 | 36.1 / 30.9 / 27.7 |
| YandereNeo | 0.0 / 0.6 / 3.7 | 0.0 / 0.2 / 1.4 | 43.8 / 37.3 / 33.5 |
| waifu2x art | 0 / 0 / 0 | 0 / 0 / 0 | 55.0 / 51.5 / 49.1 |

每多跑一遍，GAN 模型就把自己的痕迹再叠一层：红边、描深、平涂区纹理（`flat_noise` 单调上升），
animevideov3 每遍再提亮约 2 级。没有哪个模型第二遍比第一遍更干净。双重放大降噪对 gpt-image 输出是负收益。

## ncnn 可用性

- `upscayl-bin` 能直接跑 pnnx 转出的 ESRGAN 模型：YandereNeo（OpenModelDB 原始 .pth，sha256 `988f57dd…` 与测试权重逐值相同）
  经 `pnnx` 转 ncnn、把输入输出 blob 改名 `data` / `output` 后可用，和 torch 输出平均差 0.09/255，RGBA 正常。
  Radeon 780M 核显：W 27.7s / T1 30.3s（`digital-art-4x` 22.0s / 25.6s；animevideov3 6.3s / 8.3s）。
- Upscayl 自带的 `upscayl-lite-4x` 和官方 `realesr-animevideov3-x4`（realesrgan-ncnn-vulkan 20220424）md5 不同，
  对透明立绘输出整片错误；官方权重正常。随包必须用官方权重。
- waifu2x swin_unet 只有 PyTorch / ONNX，没有 ncnn 版本。DAT2/RCAN/RealPLKSR-DySample 转 ncnn 未验证。
