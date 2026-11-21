# prompt-style（R4 A/B round 1：提示词结构 × 反破碎块 × complexity 参数）

验证内容：同一真实图像接口（`gpt-image-2.6-flare` 经中转，env `NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY/NL_IMAGE_MODEL`）下，3 个主体（CG `cg-first-rain`、背景 `beiping-street`、立绘 `xiangzi/puller`）× 6 个变体 × 2 样本 = 36 次纯文生图调用。变体：V0=R3 中文散文提示词原样；V1=V0+店主反破碎块（中文原文，独占一行）；V2=Codex 式标签化英文 spec（Use case/Asset type/Primary request/Scene/Subject/Style/Composition/Lighting/Color/Constraints，内容与 V0 同语义翻译）；V3=V2+`Rendering:` 行（块的英文译文）；V4=V3+API 参数 `complexity:"low"`；V5=V0+`complexity:"low"`。36 次全成功，`complexity` 被中继接受。产出 `results.jsonl`（latency/usage/revised_prompt/参数/错误分类）、`gen/*.png`（gitignored）、`thumbs/*-thumb.webp`（480px）、`contact/*.jpg`（含 `-blind` 盲评版，映射在 `metrics/blind-map.json`）、`metrics/metrics.jsonl`+`metrics-agg.json`（Canny 边缘密度/FFT 高频能量/微对比度比/Lab k-means 色块面积/高光占比/边缘连通域每兆像素，公式见 `src/metrics.py` docstring）、`metrics/judge*.json`（typesafe/jev-1.14.0 逐图盲评：frag/micro/ai/shape/vn 五维 0-3 分）。支撑报告 `local://r4-ab1.md`。

文件：`src/api.mjs`（openai SDK 客户端，并发 6，错误分类）、`src/prompts.mjs`（V0-V5 全部提示词）、`src/run.mjs`（跑全部组合+缩略图）、`src/metrics.py`（指标，uv venv）、`src/contact.py`（拼图+盲评图）。

重跑：
```
cd .workflow/evidence/spikes-r4/prompt-style
npm i openai sharp
uv venv .venv && uv pip install -p .venv/bin/python numpy opencv-python-headless scikit-image scikit-learn scipy Pillow
source "$NL_IMG_ENV"            # 含 NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY 的 .env
node src/run.mjs                # 36 calls，约 4 min（可加主体名过滤）
.venv/bin/python src/metrics.py
.venv/bin/python src/contact.py
```
盲评：`judge_batch` 逐图（见 session 中 `metrics/judge-perimg.json` 的 states 结构），rubric 在 `src/judge_prep.mjs`。勿把 key/host 写进任何文件。
