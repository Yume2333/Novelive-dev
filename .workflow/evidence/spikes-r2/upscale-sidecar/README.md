# upscale-sidecar（R2 放大追加轮：upscayl-bin + 高保真测试图 + 盲测网格）

验证内容：所有者追问「画质最好的放大模型 vs Upscayl」的第二轮实测——upscayl-bin 任意 ncnn 模型加载、Upscayl 内置 7 模型的许可逐一核对、动漫立绘/背景/照片盲测网格、transformer 系（Nomos8kSC/HFA2k/NMKD）计时。结论与许可表在 `append.md`。支撑报告 `.workflow/research/refs/ext-2026-11-r2-upscale.md` 附录（§追加1-5）；修订了第一轮「默认 CUGAN」→「默认 `realesrgan-x4plus-anime`」。

文件：`append.md`（追加报告全文，含 Upscayl 模型许可表）、`gen_hd_test.py`（合成带线稿/发丝的 HD 测试图）、`make_grid.py`（裁同区域拼 8 列标注网格）、`run_model.sh`（upscayl-bin 计时壳）、`results/bench2.tsv`、`compare/grid_*.png`（3 张盲测网格，已从 ~2900px 宽缩到 1600px 宽归档）、`test-imgs/`（合成的 bg_gen1024 + sprite_hd_1024x1280）。`upscayl-bin` 二进制、`models/`（~630MB 权重）、`custom-models/`、`upscayl-src/`、`upscayl-ncnn/` 第三方 repo 未拷。

重跑：`python3 gen_hd_test.py` 生成 test-imgs；下载 `upscayl-bin`（`github.com/upscayl/upscayl-ncnn` release `upscayl-bin-20251207-174704-linux`，AGPL-3.0）放到 `bin/upscayl-bin`（或 `UPSCAYL_BIN=路径`）；模型权重放 `models/all/`（来源与许可见 append.md 表）；`./run_model.sh <model-name> in.png out.png` 追加 `results/bench2.tsv`；`python3 make_grid.py src.png x0,y0,x1,y1 out.png name:4x.png ...` 拼网格。

第三方依赖：upscayl-bin（AGPL-3.0）、各 ncnn 权重（BSD-3/CC-BY-4.0/NC 混合，见 append.md）、Python3+PIL、playwright 不需要。
