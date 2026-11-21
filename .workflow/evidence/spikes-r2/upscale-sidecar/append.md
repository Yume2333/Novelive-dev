
---

## 追加：所有者追问——画质最好的放大模型（vs Upscayl）

第二轮实测。环境同前（Radeon 780M 核显 / RTX4060 / llvmpipe，ncnn-vulkan）。**已按所有者决定：不用 Python，创作端直接 spawn ncnn-vulkan 二进制；alpha 一律 RGBA 直通。** 本轮工作目录即本目录（原 `/tmp/nl-r2/R2UpscaleSidecar/`，已归档为 `.workflow/evidence/spikes-r2/upscale-sidecar/`）。

### 追加1. Upscayl 的模型到底是什么、能不能拷

Upscayl（AGPL-3.0，`github.com/upscayl/upscayl`）内置 7 个模型（`common/models-list.ts`、`resources/models/`）。逐一核对来源与许可：

| Upscayl 模型名 | 实际来源 | 许可 | 能否随 Novelive 包分发 |
|---|---|---|---|
| `upscayl-standard-4x` | = Real-ESRGAN `realesrgan-x4plus`（md5 `b37a46b…` 与本仓 ncnn 权重逐字节相同） | BSD-3 | ✅ 可 |
| `upscayl-lite-4x` | realesr-animevideov3 系（轻量 anime video 模型） | BSD-3 | ✅ 可 |
| `high-fidelity-4x` | = Helaman `4xHFA2k`（README 致谢，custom-models 同名文件） | CC-BY-4.0 | ✅ 可（需署名） |
| `digital-art-4x` | = Real-ESRGAN `realesrgan-x4plus-anime`（md5 `66f0045…` 逐字节相同） | BSD-3 | ✅ 可 |
| `remacri-4x` | Foolhardy Remacri | UI 明示 **"Non-Commercial"** | ❌ 不可（商用 app 禁） |
| `ultramix-balanced-4x` | Kim2091 Ultramix | CC BY-NC-SA（UI 明示 Non-Commercial） | ❌ 不可 |
| `ultrasharp-4x` | Kim2091 `4x-UltraSharp`（HF 卡明示 CC BY-NC-SA 4.0） | CC BY-NC-SA | ❌ 不可 |

- **关键**：所有者"喜欢"的 Upscayl 默认（`upscayl-standard`=x4plus）与"动漫模型"（`digital-art-4x`=x4plus-anime）**都是 BSD-3、逐字节可拷**；但 Upscayl 里画质更受好评的 Remacri/Ultramix/Ultrasharp **全是 Non-Commercial / CC-BY-NC-SA，不能进 Novelive 安装包**（我们 AGPL 应用要商用）。
- `upscayl-bin`（`upscayl/upscayl-ncnn` release 的 CLI 二进制）= **AGPL-3.0**，与 Novelive 同许可，**是 realesrgan-ncnn-vulkan 的直接替代品**，且更强：`-m <dir> -n <name>` 可加载**任意 ncnn .param/.bin 模型**（实测加载 Nomos8kSC/HFA2k/NMKD 均能跑），原生支持 `-r`/`-w` 输出重采样、`f` 输出格式。若要用非 xinntao 自带权重，upscayl-bin 是唯一现成入口。

### 追加2. 其他免 CUDA 候选的可行性与许可

| 模型 | 架构/运行时 | 许可 | 可行性 |
|---|---|---|---|
| `4xNomos8kSC`（Helaman，SRFormer） | ncnn 经 upscayl-bin | CC-BY-4.0 | ✅ 跑得动但慢（~22s/图,1GB RAM）；偏照片，对动漫线条偏软 |
| `4xHFA2k`（Helaman，SRFormer/GRLGAN） | ncnn 经 upscayl-bin | CC-BY-4.0 | ✅ 跑得动；动漫发丝区出现色块瑕疵，照片最好 |
| `4xLSDIRplusC` / `4xLSDIR` | ncnn | 待核（LSDIR 数据集条款） | ⚠️ 不取（条款不确定） |
| `4x_NMKD-Superscale` / `NMKD-Siax` | ncnn | WTFPL | ❌ Siax 输出全黑、Superscale 输出偏暗——GAN 模型与 upscayl-bin 流程不兼容，弃 |
| `realesr-animevideov3`（=upscayl-lite） | ncnn | BSD-3 | ✅ 快（1.2MB）但画质最弱，只作兜底 |
| `realesrgan-x4plus-anime`（=digital-art-4x） | ncnn | BSD-3 | ✅ **画质冠军**（见下） |
| Real-CUGAN（models-se/pro） | 自带 realcugan 二进制 | MIT | ✅ 但动漫线条出现红边色晕（见下） |
| waifu2x（cunet） | 自带 waifu2x 二进制 | MIT | ✅ 干净但偏软，任意倍数可用 |
| AnimeSharp/V2/V3/V4、TextSharp、UltraSharpV2 | RCAN/RealPLKSR 等 | **CC BY-NC-SA 4.0**（HF/OpenModelDB 明示） | ❌ 全部 Non-Commercial，不可分发 |
| APISR、SPAN/Compact OpenModelDB 动漫变体 | 多为 torch/spandrel，OpenModelDB 多数 CC BY-NC-SA | 多为 NC/未标 | ❌ 既需 Python 又许可不友好 |
| onnxruntime-node 托管任意 onnx | onnx | – | ❌ npm 包 307MB，且 EP 另计；不如 ncnn 二进制 |

### 追加3. 盲测：画质对比（动漫内容，100% 裁切并排）

测试图：`bg_gen1024.png`（含房屋/树木/线稿的动漫背景，1024px）、`sprite_hd_1024x1280.png`（RGBA 立绘，发丝软边 + 眼线/嘴线线稿）、`input2.jpg`（256px 真实照片，对照）。各模型 4x 放大后裁同一区域并排、列名标注。

- **网格文件**：`compare/grid_background.png`、`compare/grid_sprite_eye.png`、`compare/grid_photo.png`（8 列 = SRC-bicubic + 7 模型）。
- **动漫背景**（grid_background）：`digital-art-4x` 与 `realesrgan-anime` **并列最锐**（房屋黑线、窗格、树叶最干净）；`realcugan` 次之；`Nomos8kSC`/`HFA2k`/`upscayl-std` 渐软；`NMKD-Superscale` 输出异常偏暗。
- **立绘眼部线稿**（grid_sprite_eye）：`digital-art-4x` **最佳**（睫毛、嘴线、发丝最利落无毛边）→ `realesrgan-anime` 略软 → `waifu2x` 平滑但细节软 → `realcugan` 出现过锐伪影（**嘴线带明显红色色晕/串色**）→ `Nomos8kSC` 偏糊 → `HFA2k` 发区色块瑕疵。
- **照片对照**（grid_photo）：`HFA2k` 最佳、`waifu2x` 次之；动漫系（digital-art/anime）把沙/水**压成平涂海报**——但这与我们领域无关（我们只放大 AI 动漫图）。
- **alpha**：6 个模型对 RGBA 立绘直通后 alpha MAE 均 = 0.06/255、半透像素 ~20 万保留，**全部干净无串色**——确认"RGB 直通"对最终选型也成立。

### 追加4. 计时/内存（核显 -g1，1024–1280px 输入→4x）

| 模型 | bg 4x | sprite 4x | photo 4x | peak RSS |
|---|---|---|---|---|
| `realesrgan-x4plus-anime`/`digital-art-4x` | 6.2–7.5s | 13.7–14.9s | 4.5–5.3s | ~400–520MB |
| `realesr-animevideov3` | ~3s | – | – | ~214MB |
| Real-CUGAN（se 4x） | 2.7s | 2.6s | 3.0s | ~250–280MB |
| `upscayl-standard`（x4plus） | 15–24s | – | 27s | ~1.0GB |
| `4xNomos8kSC` | 22s | 48s | 15s | ~1.0–1.1GB |
| `4xHFA2k` | 25s | 45s | 12s | ~1.0GB |
| `4x_NMKD-Superscale` | 21s | 65s | – | ~1.0GB |
| waifu2x-cunet | ~3.5s | ~40s | ~3.4s | ~190MB |

→ transformer 系（Nomos8kSC/HFA2k/NMKD）慢 2–4× 且吃 ~1GB 内存；**赢家 `realesrgan-x4plus-anime` 反而又快又省**。

### 追加5. 推荐（修订第 92–95 行的旧建议）

**对"画质最好"的直接回答**：在 Novelive 的真实内容（AI 生成的动漫立绘/背景/CG）上，**画质最好且可随包分发的模型是 `realesrgan-x4plus-anime`（= Upscayl 的 `digital-art-4x` 逐字节同一个权重，BSD-3）**。它正是 Upscayl 的"动漫模型"，所以**没有任何免 CUDA 模型在动漫线上稿上稳定胜过它**——而 Upscayl 里更"锐"的 Remacri/Ultramix/Ultrasharp 全部是 Non-Commercial，进不了我们的商用 AGPL 应用。

- **主模型（默认）**：`realesrgan-x4plus-anime`（BSD-3，8.9MB）。对动漫线稿、眼部、发丝最锐最净，alpha 干净，速度尚可（核显 6–15s/图），且就是 Upscayl 用户已认可的"动漫模型"。
- **次选/兜底**：`realesr-animevideov3-x4`（BSD-3，1.2MB，最快）作为低配置机/快速档；"更柔一档"留 `waifu2x-cunet`（MIT）。
- **修正旧建议**：此前 §5-B 建议默认 CUGAN——本轮在立绘线稿上发现 CUGAN 产生红色色晕、且画质判定逊于 ESRGAN-anime，**故默认改回 `realesrgan-x4plus-anime`**，与原 handoff 默认一致，无需改 decisions.md。
- **二进制**：首选 **`upscayl-bin`**（AGPL，drop-in 兼容 realesrgan-ncnn-vulkan 全部参数 + 支持任意 ncnn 模型 + 内置输出重采样）；若担心 AGPL 二进制，回退 `realesrgan-ncnn-vulkan`（MIT，参数同集，能跑 x4plus-anime/x4plus/animevideov3）。
- **许可红线**：**不要**随包 AnimeSharp/UltraSharp/Ultramix/Remacri/Nomos 之外的任何 OpenModelDB 模型——绝大多数是 CC BY-NC-SA。若要带 Nomos8kSC/HFA2k 做备选，二者为 CC-BY-4.0，需在 About/NOTICE 署名，但画质对本域不占优，不建议带。
