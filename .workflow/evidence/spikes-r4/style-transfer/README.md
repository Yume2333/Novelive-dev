# style-transfer（参考图只给画风，画一个新角色）

正式管线的用法：参考图只提供画风，画的是另一个角色。参考图用 `brushwork/` 里的 A（黑白厚涂）和 C（galgame 校服）；B 参考不好，不再用。参考图是第三方插画，在 `ref/`，不进仓库。

- 角色句改成“只参考画风，不要照抄图 1 里的角色”。
- 两张参考图画同一个新角色：浅金色短卷发、侧分、左耳上方银色星形发卡、绿眼睛、细圆金框眼镜、米色麻花毛衣配白衬衫领、深绿长百褶裙。立绘双手把棕色皮面笔记本抱在胸前；CG 是午后咖啡馆窗边写笔记本。完整英文在 `src/run.mjs` 的 `NEW`。
- 立绘 1024×1536 透明底；CG 1024×1536 竖图。
- 最后一行同 `brushwork/` 的 4 组：FX 现行、FXB 例外加笔触、FXBM 加媒介句、NXBM 去掉平涂喷枪。

2 张参考图 × 立绘和 CG × 4 组 × 2 次 = 32 次调用，`gpt-image-2.6-sunburst`、`quality: high`、`images.edit`，图 1 只放参考图，出图后过 D1（`realesrgan-x4plus-anime`）。调用记录在 `results.jsonl`。

## 重跑

```sh
export NL_IMAGE_BASE_URL=... NL_IMAGE_API_KEY=...
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan REALESRGAN_MODELS=<path-to>/models
node src/run.mjs               # 可选参数：[A,C] [sprite,cg] [r1,r2] [FX,FXB,FXBM,NXBM]
node src/postproc.mjs
python src/contact.py          # 需要 Pillow
```

对比图在 `contact/`（不进仓库）：`A.png`、`C.png` 按原像素拼，上行立绘、下行 CG，列为 4 组各 2 次；`A/`、`A-raw/` 是翻页文件夹（D1 / 原图），`00-ref.png` 是参考图。
