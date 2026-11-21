# upscale（R2 放大模型第一轮：ncnn-vulkan 二进制 + 合成测试图 + bench）

验证内容：realcugan/realesrgan/waifu2x 三个 ncnn-vulkan CLI 的核显/独显/CPU 三档计时、alpha RGBA 直通正确性（MAE 0.04/255）、降噪档位、PyInstaller sidecar 体积。全部原始数字在 `report-data.md` 与 `results/bench.tsv`。支撑报告 `.workflow/research/refs/ext-2026-11-r2-upscale.md` §1.2-1.7；gap-ledger A1/A2/A3 取舍的证据。

文件：`gen_test_imgs.py`（PIL/numpy 合成 4 张测试图，协议自洁无版权问题）、`test-imgs/`（合成的 bg/sprite/cg + 实拍 input 对照）、`bench.sh`（计时+peak RSS 壳）、`pkg/sidecar/upscaler.py`+`pkg/upscaler-sidecar.spec`（Python stdin/stdout JSON 薄包装 + PyInstaller spec）、`shots/`（alpha 边缘/对比裁切，≤1600px）。ncnn 二进制、模型权重、`venv/`、`work/out/` 全尺寸输出图未拷。

重跑：先 `python3 gen_test_imgs.py` 生成 `test-imgs/`；下载二进制到 `bin/`（版本与 URL：`realcugan-ncnn-vulkan-20220728-ubuntu`、`realesrgan-ncnn-vulkan`（xinntao release）、`waifu2x-ncnn-vulkan-20250915-linux`，均在 github.com/nihui|xinntao release，MIT/BSD-3）；`./bench.sh <name> <bin> -i in.png -o out.png -s 4 -n 0 -g 1` 写 `results/bench.tsv`。

第三方依赖：ncnn-vulkan 三二进制（MIT/BSD-3，见 report-data.md §Licenses）、Python3 + PIL + numpy（gen_test_imgs）、PyInstaller 6.22+（若测 sidecar 打包）、`/usr/bin/time -v`。
