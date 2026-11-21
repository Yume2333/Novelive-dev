# R2 放大与降噪（upscale sidecar）实测报告

环境：AMD Ryzen 7 8845H + Radeon 780M（核显）+ RTX 4060 Laptop（独显），30GB RAM，Fedora Linux 7.3.3；Vulkan 1.4 检测到全部三设备（`[0]=RTX4060`、`[1]=Radeon780M/RADV`、`[2]=llvmpipe`纯CPU）。所有运行均在 `/tmp/nl-r2/upscale/`，原始数据见 `report-data.md`。

## 1. 结论（最重要在前）

1. **运行时已选定且无需 CUDA**：三个 `*-ncnn-vulkan` 单文件可执行程序（realesrgan / realcugan / waifu2x）开箱即用，自动探测 NVIDIA/AMD/llvmpipe 任一 Vulkan 设备，也能 `-g -1` 退到纯 CPU(ncnn)。Win/macOS/Linux 都有官方预编译包。**不需要任何 Python、torch、onnxruntime**。
2. **首要推荐：Real-CUGAN（`realcugan-ncnn-vulkan`，models-se）**。实测最快、权重最小（2.5–2.7MB/档）、alpha 干净、自带 n0–n3 降噪档。1024×576→4x 在**核显上 2.7–3.1s**、**纯 CPU 11.2s**，远快于 Real-ESRGAN-anime（核显 8.6s、CPU 78.7s）。
3. **质量取舍**：CUGAN 在中低频/真实照片上最优，但在高对比细碎细节（星空、远处轮廓）上偏软（4x 星空 3–4/10），ESRGAN-anime 反而更锐利（7/10）。两者都在动漫内容上忠实（PSNR 38–39dB）。**建议 CUGAN 为主、ESRGAN-anime 作为"锐利度优先"备选档**，二者权重共 ~14MB。
4. **alpha 通道：直接整图 RGBA 过模型即可**。实测 alpha 边缘 MAE 0.04/255，无白边、无棋盘格串色、软边保留。**不需要拆分 alpha / 双三次放大再合成**（handoff 里那条"拆 alpha 单独放大"的试验结论应改为"直接 RGBA"）。模型对 RGBA 四通道同处理。
5. **降噪不需要单独模型**：CUGAN/ESRGAN/waifu2x 的超分模型内置降噪，噪声 std 7.91→0.4–0.5（干净图 0.37）。gpt-image 输出若带噪点，选 CUGAN n3 即可覆盖；`-s 1`（纯降噪不放大）在 models-se 下会崩，需用放大档顺带降噪。
6. **任意目标分辨率需"放大→重采样"两段式**：ncnn 模型只出整数倍（CUGAN 2/3/4x，ESRGAN 4x，waifu2x 支持任意倍数如 2.5 但质量不占优）。1024→2560×1440（2.5x）必须放大到邻近整数倍再让 sharp 降到目标。实测 CUGAN-4x→降到 2560 = 3.16s，CUGAN-2x→升到 2560 = 2.03s（后者更快且已足够锐）。
7. **"是否还需要 Python 进程"——实测倾向于不需要**（所有者取舍）：ncnn 二进制本身就是独立可执行文件，Node 用 `child_process` + 临时文件路径就能驱动，stdio 协议和现有决策完全兼容（行分隔 JSON、传路径）。套 Python 只会增加 22MB（PyInstaller）~105MB（python-build-standalone+uv 基座）体积和一个解释器，零收益。**详见 §5 取舍**。
8. **许可全部干净可随包分发**：realcugan/ncnn-vulkan MIT、realesrgan/ncnn-vulkan MIT、Real-ESRGAN BSD-3、waifu2x-ncnn-vulkan MIT、ncnn BSD-3、上游 Real-CUGAN MIT。与 AGPL-3.0 应用兼容，二进制+权重可再分发。
9. **打包体积极小**：realcugan 二进制(9.7MB)+2x/4x 权重(5MB)=**~15MB**；realesrgan+x4plus-anime=**~20MB**；waifu2x+cunet2x=**~11MB**。三选一或全带都在 50MB 内，远好于 PyTorch/onnxruntime 方案（onnxruntime-node 一个包就 307MB）。

## 2. 证据

> 原始逐条计时：`/tmp/nl-r2/upscale/report-data.md`；命令 `bench.sh` 用 `/usr/bin/time -v` 记 wall + peak RSS。

### 2.1 速度（wall 秒，输入 1024×576 PNG；`-g1`=Radeon780M 核显 / `-g0`=RTX4060 / `-g2`llvmpipe / `-g-1`纯ncnn-CPU）
| 命令 | 核显 | 独显 | CPU | peak RSS |
|---|---|---|---|---|
| `realcugan -s4 -n0` | 2.7–3.1 | ~3.0 | 11.2 (-g-1) | 250MB(CPU 9.4GB) |
| `realcugan -s2 -n0` | 1.5–2.6 | 3.8 | 5.7 (-g-1) | 193MB(CPU 3.0GB) |
| `realesrgan -n realesrgan-x4plus-anime` | 8.6–9.5 | 6.4 | 78.7 (llvmpipe) | 400MB(CPU 1.6GB) |
| `realesrgan -n realesr-animevideov3 -s4` | 2.0–3.0 | – | – | 214MB |
| `waifu2x -s2 -n0 (cunet)` | 1.2 | 3.9 | – | 157MB |
| 进程启动开销（64×64 图） | 0.33 | – | – | – |
- 来源：本地实测，2026-11-21，命令见 `report-data.md`。
- 完整 2K 管线：CUGAN-4x→PIL Lanczos 降到 2560×1440 = **3.16s**；CUGAN-2x→升到 2560×1440 = **2.03s**。

### 2.2 质量
- **森林纹理**（合成，1024×576，放大 4x 再降回原尺寸测 PSNR）：ESRGAN-anime 39.3dB > CUGAN 37.9dB > esrgan-animevideov3 33.4dB；双三次 roundtrip 基线 54.8dB。→ 命令：`grain_std/PSNR` 脚本，`work/out/*_forest_4x.png`。
- **真实照片 input2.jpg（256px，Real-ESRGAN 自带样例）4 图并排**：视觉判定 CUGAN 最自然锐利，waifu2x 干净，ESRGAN-anime 把照片过度海报化（动漫模型特性）。→ `work/out/grid_input2.png`。
- **CG 星空/鸟居 4x（细碎高对比细节）**：ESRGAN 7/10 = waifu2x 7/10 > CUGAN-pro(3x)5/10 > CUGAN-conservative 4/10 > CUGAN-n0 3/10。→ `work/out/cmp_*_cg.png`。
- **alpha 立绘 768×1024 RGBA（软发丝边）**：整图 RGBA 直通，alpha 相对双三次基线 MAE=0.04/255；棋盘格底复核 CUGAN 与 ESRGANv3 均无白边/暗边/串色，软渐变保留。→ `work/out/cbz_*.png`、`crop_*_edge_onbg.png`。
- **合成图局限性说明**：本机生成的测试图偏软（PIL 模糊云/毛发），真实照片 input2.jpg 上 ESRGAN-anime 海报化、CUGAN 自然——动漫插画预期更接近后者，但**建议落地时再用真实 gpt-image 样张复核一次 CUGAN vs ESRGAN**（见 §5）。

### 2.3 降噪
- 噪声源（σ≈12 高斯噪）：平坦区高频 std 7.91；放大后 CUGAN-n3=0.49、CUGAN-n0=0.56、ESRGAN=0.41，干净原图=0.37。**三款模型都顺带降噪**；CUGAN `-n` 档（-1 无/0/1/2/3）里 n3 视觉最净。→ `work/out/dn_*.png`。
- `-s 1`（仅降噪不放大）在 models-se 报 `find_blob_index_by_name ... failed` 且无输出 ⇒ 不支持纯降噪，必须用放大档。

### 2.4 许可（逐 LICENSE 文件核）
- `realcugan-ncnn-vulkan` 及其 `models-se/pro/nose`：MIT，随 zip 附 LICENSE（`/tmp/nl-r2/upscale/bin/realcugan/*/LICENSE`）。上游 Real-CUGAN bilibili/ailab `Real-CUGAN/LICENSE` = MIT（https://github.com/bilibili/ailab/blob/main/Real-CUGAN/LICENSE，2026-11-21 核）。
- `realesrgan-ncnn-vulkan`：MIT（https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/blob/master/LICENSE）。Real-ESRGAN 主仓 = BSD-3-Clause（GitHub repo 页脚）。ncnn = BSD-3。
- `waifu2x-ncnn-vulkan`：MIT（随包 LICENSE，nihui）。
- 结论：均为宽松许可，二进制+权重可再分发，与 AGPL-3.0 应用兼容。

### 2.5 打包体积
- 最小载荷（二进制+1–2 个权重）：realcugan **15MB**、realesrgan+x4plus-anime **20MB**、waifu2x+cunet **11MB**。
- onnxruntime-node npm 包解包即 **307MB**（`npm view dist.unpackedSize`），还需另加 DirectML/CoreML EP 与权重 ⇒ 否决。
- PyInstaller 6.22.3 `--onedir` 一个 30 行的薄包装 = **22MB**、可端到端跑通；python-build-standalone cpython-3.12 tarball **105MB**（uv 的基座），尚未计依赖。

## 3. 对照现有设计

| 现有设计/决策 | 实测结论 | 状态 |
|---|---|---|
| Python 进程做放大降噪（decisions.md:188–193；architecture.md:26–27） | ncnn 二进制可独立运行、Node 直接 spawn 即可，Python 层非必需 | **冲突/取舍** — 见 §5（建议降 Python 为可选） |
| stdio 通信、行分隔 JSON、图片传临时文件路径（handoff-defaults.md:69） | 二进制正好吃文件路径，Node spawn + 临时文件即可满足同一协议 | 已覆盖/可不改协议 |
| 放大用可随包分发的二次元模型、不依赖 NVIDIA、M3 先试验（decisions.md:582） | ncnn-vulkan 核显/CPU 都跑通，无 CUDA 依赖，权重 1–9MB 可分发 | 已覆盖（试验已完成） |
| 降噪由超分模型内置强度承担、不立单独模型（handoff-defaults.md:67） | 实测三款模型均顺带降噪，CUGAN n3 最净 | 已覆盖 |
| 放大默认选型 Real-ESRGAN `x4plus-anime`+ncnn（handoff-defaults.md:67、ext-visual-pipeline.md:68） | CUGAN 实测更快更小、照片更自然；ESRGAN 仅在细碎高对比细节更锐 | **冲突** — 建议默认改 CUGAN、ESRGAN 作备选（§5） |
| alpha 拆通道单独双三次放大再合成（handoff-defaults.md:68） | 实测整图 RGBA 直通即可，无串色无 halo | **冲突** — 应改为直接 RGBA（§5） |
| 放大到 2560×1440 默认、可选 4K、立绘同倍（visuals.md:55；decisions.md:463） | 整数倍模型需"放大→sharp 重采样"两段式才能达到非整倍目标；实测可行且快 | 缺口 — 需在 visuals.md 或 pipeline 注明"先整数倍放大、再 sharp 到目标" |
| RealESRGAN_x4plus ≈64MB 权重起步（handoff-defaults.md:70） | 实测 x4plus-anime ncnn 权重仅 8.9MB（x4plus 通用版 33MB），比预期小 | 数据更正 |
| WebP 有损 q90、保留透明通道（visuals.md:56） | ncnn 二进制 `-f webp` 直出 RGBA WebP（1536×2048 实测 mode=RGBA），可省一步转换 | 已覆盖/顺带利好 |
| 放大安装包体积与单图时间限值（handoff-defaults.md:70） | realcugan ~15MB、单图 <3.2s（核显）/11.2s（纯CPU） | 已覆盖，限值可据此定稿 |

## 4. 可拷资产

| 资产 | 位置 | 许可 | 大小 |
|---|---|---|---|
| `realcugan-ncnn-vulkan` 可执行 + `models-se`（up2x/up3x/up4x × n0/n3/conservative） | `bin/realcugan/realcugan-ncnn-vulkan-20220728-ubuntu/`（上游 https://github.com/nihui/realcugan-ncnn-vulkan/releases/tag/20220728） | MIT | 二进制 9.7MB + 每档 ~2.5MB |
| `realesrgan-ncnn-vulkan` 可执行 + `realesrgan-x4plus-anime`（+ `realesr-animevideov3-x4`） | `bin/realesrgan/`（https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/tag/v0.2.0 或 Real-ESRGAN release 20220424） | MIT（权重 BSD-3） | 二进制 11.4MB + anime 8.9MB（v3 仅 1.2MB） |
| `waifu2x-ncnn-vulkan` 可执行 + `models-cunet` | `bin/waifu2x/waifu2x-ncnn-vulkan-20250915-linux/`（https://github.com/nihui/waifu2x-ncnn-vulkan/releases/tag/20250915） | MIT | 二进制 8.3MB + cunet ~24MB |
| 测试图源（自合成，许可干净） | `test-imgs/*.png` + `gen_test_imgs.py` | 本仓自生，无版权问题 | ~280KB |
| 真实样例 `input.jpg`/`input2.jpg` | `bin/realesrgan/input*.jpg` | 随 Real-ESRGAN 包（同 MIT） | ~23KB |
| 计时/质检脚本 | `bench.sh`、`report-data.md` | 本仓自生 | – |

## 5. 需要所有者取舍的事

**A. 要不要保留 Python 进程？（最重要）**
- 现状决策要求一个 Python 进程（decisions.md:188）。但实测 ncnn 二进制是独立可执行文件，Node `child_process.spawn` + 临时文件路径即可驱动，stdio JSON 协议不变。
- 选项1：**去掉 Python，创作端直接 spawn ncnn 二进制**。省 22–105MB、省一个解释器、少一层进程。代价：若未来要接 PyTorch/spandrel 模型（如 APISR、SPAN 系）则需重新引入。
- 选项2：**保留 Python 薄包装**（PyInstaller onedir ~22MB），为未来 torch 模型留门，但当前版本纯属负担。
- **我的建议：选 1（去 Python）**，把"放大降噪子进程"定义为"由创作端 spawn 的 ncnn-vulkan 二进制"，协议与现决策一致；若 M5 后要更强模型再评估。理由：本里程碑的需求（动漫图、无 NVIDIA、可分发、2K/4K、alpha）ncnn 已全覆盖且实测达标。

**B. 默认模型选 CUGAN 还是 ESRGAN-anime？**
- CUGAN：快 3–4×、权重小 3×、照片/真实内容更自然、自带降噪档；但对极细碎高对比细节（星空）偏软。
- ESRGAN-anime：细碎细节最锐，但慢、体积大、对照片会海报化。
- **建议：默认 Real-CUGAN（models-se，n0 或 n1），在作品设置里加一个"锐利优先"开关切到 ESRGAN-anime**——既满足"二次元模型、不依赖 NVIDIA"，又保留 ESRGAN 的细节优势。若只许带一个，带 CUGAN。

**C. 2K/4K 的放大路径**
- CUGAN 只整数倍。建议：目标 2560×1440 用 **4x→sharp 降到目标**（保细节，3.2s）或 **2x→升到目标**（更快 2.0s，稍软）；4K 目标统一 4x→降。立绘同倍即可，RGBA 直通。

**D. alpha 处理结论回写**
- handoff 里"拆 alpha 单独放大再合成"应改为"**整图 RGBA 直通模型**"，更简单且实测无串色。若个别模型对 alpha 通道产生色偏再退回拆通道方案（本次未观察到）。

**E. 体积/耗时限值定稿**
- handoff 说"实测再定限值"。建议 spec 写：随包 ncnn 模型 ≤20MB、单图 1024→2K ≤10s（按最慢 CPU 路径留出余量，核显 <4s）。

---

## 追加：所有者追问——画质最好的放大模型（vs Upscayl）

第二轮实测。环境同前（Radeon 780M 核显 / RTX4060 / llvmpipe，ncnn-vulkan）。**已按所有者决定：不用 Python，创作端直接 spawn ncnn-vulkan 二进制；alpha 一律 RGBA 直通。** 本轮工作目录 `/tmp/nl-r2/R2UpscaleSidecar/`。

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
