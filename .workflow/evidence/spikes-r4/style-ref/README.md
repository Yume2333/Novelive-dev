# spikes-r4/style-ref — 第 2 轮 A/B：主视觉作为风格参考

生产路径验证：每张下游资产都是一次 `client.images.edit` 调用，Image 1 固定为
该臂的主视觉（key visual），风格/渲染语句由代码拥有，模型只写内容句。

## 臂位设计（9 臂 × 3 资产 × 2 样张 = 54 次 edit 调用 + 4 次主视觉 generate）

| 臂 | 主视觉 | 提示词格式 | 渲染块 |
|----|--------|-----------|--------|
| B0 | kv-r3（第 3 轮水彩风，细节多） | 第 3 轮中文散段 + 第 3 轮风格行 | 无 |
| B1 | KV-O（M+块O） | 英文标签 spec + 中文内容句 | 块 O（owner 原文，英文） |
| B2 | KV-P（M+块P） | 同上 | 块 P（正向重写，英文） |
| B3 | KV-P | 同上 | 无（只靠参考图带风格？） |
| B4 | KV-P | 同 B2 | 块 P + `quality:"medium"` |
| B5 | KV-P | 同 B2 + 负向行 N | 块 P + `Avoid:` 行 |
| B6 | KV-P | 同 B2 但内容句全英 | 块 P（语言效应） |
| B7 | KV-O | 纯中文散段（中文参考角色句 + 中文 M 行 + 内容句） | BLOCK_ZH 尾行（第 1 轮胜者） |
| B8 | KV-O | 同 B7 | 块 O 英文尾行（隔离块语言） |

主视觉：KV-O = 行 M + 块 O；KV-P = 行 M + 块 P；各 2 样张取 s1。
基线主视觉 `gen/kv-r3.png` 复制自第 3 轮 `style-mainvisual.png`。

## 重跑

```bash
source <含 NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY/NL_IMAGE_MODEL 的 env 文件>
cp <第3轮主视觉.png> gen/kv-r3.png          # 已在 gen/ 中
node src/run-kv.mjs                          # Phase A: 4 次 generate
node src/run.mjs                             # Phase B: 54 次 edit（可传资产名过滤）
.venv/bin/python src/metrics.py              # 指标 + 风格匹配
.venv/bin/python src/contact.py              # 对照图 + 盲评图
# 盲评：judge_batch，states = contact/*-blind.jpg + 对应 KV 缩略图
```

`src/prompts.mjs` 是唯一 prompt 源；`results.jsonl` 记录每次调用的
params（不含图像数据）/延迟/usage/错误分类。并发上限 6。

## 文件约定

`gen/`（.gitignore）原图；`thumbs/` 480px webp 缩略图；`contact/` ≤1600px
JPEG 对照图与盲评图；`metrics/metrics.jsonl`（逐图）+ `metrics-agg.json`
（资产×臂均值）；`metrics/blind-map.json` 盲评臂码映射。
