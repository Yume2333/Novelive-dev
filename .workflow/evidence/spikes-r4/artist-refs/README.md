# artist-refs（F+X 在另外三种画风上的表现）

定稿的画风固定句 F+X（原文见 `docs/visuals.md` 2.4 第 7 条，也在 `src/run.mjs` 的 `LASTLINE`）换三张其他画师的参考图验证画风能不能保住、鱼鳞纹能不能压住。

- A：黑白灰为主的柔和厚涂少女，黑色短发。
- B：粗线条、高饱和平涂少女，青色马尾。
- C：galgame 风格的校服少女，拿礼物盒。

参考图是第三方插画，在 `ref/`，不进仓库。

每张参考图画两张：参考图角色的立绘（1024×1536，透明底）和一张 CG（1536×864），各跑 3 次，共 18 次调用。固定：`gpt-image-2.6-sunburst`、`quality: high`、`images.edit`，图 1 只放这张参考图，出图后统一过 D1（`realesrgan-x4plus-anime`）。每张的完整提示词在 `src/run.mjs` 的 `CONTENT`，调用记录在 `results.jsonl`。

## 重跑

```sh
npm i openai sharp            # 或软链已有的 node_modules
export NL_IMAGE_BASE_URL=... NL_IMAGE_API_KEY=...
export REALESRGAN_BIN=<path-to>/realesrgan-ncnn-vulkan REALESRGAN_MODELS=<path-to>/models
node src/run.mjs               # 可选参数：[A,B,C] [sprite,cg] [r1,r2,r3]
node src/postproc.mjs
python src/contact.py          # 需要 Pillow
```

对比图在 `contact/`（不进仓库）：`A.png` 等按原像素拼，上行立绘 3 次、下行 CG 3 次；`A/`、`A-raw/` 是翻页文件夹（D1 / 原图），`00-ref.png` 是参考图。
