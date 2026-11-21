# size-probe（中转的大尺寸输出与 quality 是否真实）

- `probe.mjs`：同一心海提示词，`gpt-image-2.6-sunburst` + `quality: high`，分别请求 2048×1152、3840×2160（文生图）和 2048×1152、2560×1440、3840×2160（带参考图编辑）。全部按请求尺寸返回。参考图路径由 `NL_STYLE_REF` 指定（第三方插画，不进仓库）。
- 判断是不是超分：把输出缩到 1920×1080 再 Lanczos 放回原尺寸，算 PSNR。4K 编辑 48.8 dB、4K 文生图 48.9 dB、2.5K 编辑 50.0 dB；作对照，1K 图用 Lanczos 放大到 4K 是 50.4 dB，用 Real-ESRGAN 放大是 33.1 dB。中转给的 2K/4K 在 1080p 以上几乎没有新信息，和 owner 看图的判断一致。
- `quality-probe.mjs`：同一提示词 1536×1024，low 和 high 各 3 张，结果在 `quality-probe.jsonl`。low 每张输出 408 token，high 6240 token；high 的高频细节明显更多（拉普拉斯均值 72–93 对 37–50）。中转确实执行 `quality`。
- 图片在 `gen/`，不进仓库。

重跑：`npm i openai sharp`，设好 `NL_IMAGE_BASE_URL`、`NL_IMAGE_API_KEY`、`NL_STYLE_REF`，`node probe.mjs`、`node quality-probe.mjs`。
