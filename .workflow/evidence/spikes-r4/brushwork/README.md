# brushwork（保留画师笔触，同时去鱼鳞纹）

参考图、角色和内容段和 `artist-refs/` 相同（A 黑白厚涂、B 粗线平涂、C galgame 校服；第三方插画，在 `ref/`，不进仓库）。两处改动：

- CG 改成竖图 1024×1536（不透明），和参考图同向；立绘不变（1024×1536，透明底）。
- 最后一行分 4 组，测怎样在压住鱼鳞状涂抹的同时保住参考图的笔触和媒介质感。

| 组 | 最后一行 | 测什么 |
| --- | --- | --- |
| FX 现行 | S3 + H + E + X（`docs/visuals.md` 2.4 第 7 条原文） | 对照 |
| FXB 例外加笔触 | S3 + H + E + XB | 例外句里加上“图 1 的笔触和线条质感保持原样”，只扩大例外够不够 |
| FXBM 加媒介句 | S3 + H + E + XB + MED | 再把“媒介本身的质感（笔触、铅笔或颗粒、柔和厚涂边缘）要保留”和“意外的鱼鳞状涂抹要去掉”分开写 |
| NXBM 去掉平涂喷枪 | S3N + H + E + XB + MED | S3 里的“平涂底色加平滑喷枪渐变”等于指定了上色方式，可能和厚涂类画风冲突；换成“用和图 1 相同的媒介完成” |

各段英文原文在 `src/run.mjs`。每张参考图 × 立绘和 CG × 4 组 × 2 次 = 48 次调用，`gpt-image-2.6-sunburst`、`quality: high`、`images.edit`，图 1 只放参考图，出图后过 D1（`realesrgan-x4plus-anime`）。调用记录在 `results.jsonl`。

## 重跑

```sh
export NL_IMAGE_BASE_URL=... NL_IMAGE_API_KEY=...
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan REALESRGAN_MODELS=<path-to>/models
node src/run.mjs               # 可选参数：[A,B,C] [sprite,cg] [r1,r2] [FX,FXB,FXBM,NXBM]
node src/postproc.mjs
python src/contact.py          # 需要 Pillow
```

对比图在 `contact/`（不进仓库）：`A.png` 等按原像素拼，上行立绘、下行 CG，列为 4 组各 2 次；`A/`、`A-raw/` 是翻页文件夹（D1 / 原图），`00-ref.png` 是参考图。
