# image-pipeline（R3 图像管线：设计→立绘→背景→CG→审核→放大→WebP）

验证内容：OpenAI 兼容图像接口（`gpt-image-2.6-flare`，经中转）全链——角色设计稿→服装/表情立绘（透明底）→地点背景多变体→CG（v1 纯文本提示翻车 vs v2 参考图重画）、技术检查（undecodable/wrongSize/subjectCut/noAlpha/alphaNotTransparent/fakeChecker）、视觉审核打包、moderation 探测（raw/desens 两套提示）、ncnn 放大→sharp resample→WebP q90+480×270 缩略图。42 次调用全成功；错误分类含 `moderation_blocked`/火山 `Sensitive*`/400 里藏 `service_unavailable`（临时错误不能只看状态码）。支撑报告 `.workflow/research/refs/ext-2026-11-r3-image-pipeline.md`。

文件：`src/`（`api.mjs` 并发 4+错误分类客户端、`briefs.mjs` 角色/服装/表情/地点/CG 提示词集、`p1`-`p7b` 各阶段脚本、`techcheck.mjs`/`visualcheck.py`/`visualreview.py`/`safearea.py` 检查与审核打包、`upscale.mjs`/`finalize-expr.mjs` 放大+落盘链、`runall.sh` 串联）；`results.jsonl`（54 条结构化调用记录 latency/usage/error 分类）；`contact/s1–s9.jpg`（9 张证据拼图 ≤1600px）；`out/README.md`（成品清单+复跑口径）+ 4 张 480×270 `-thumb.webp` 样本（sprite×2/bg×1/cg×1，其余 WebP 成品与 `gen/` 原始 PNG、`work/` 中间图未拷——体积）。

重跑：`npm i`（openai/sharp）→ `NL_IMG_ENV=<含 NL_IMAGE_BASE_URL/NL_IMAGE_API_KEY 的 .env> bash src/runall.sh` 或逐个 `node src/p1-designs.mjs … p7b-style.mjs`；放大 `UPSCAYL_BIN=<upscayl-bin 路径> UPSCAYL_MODEL_DIRS=<模型目录冒号列表> node src/upscale.mjs bg cg sprite`；视觉审核打包 `python3 src/visualreview.py` 后走 judge_batch。

第三方依赖：`upscayl-bin`（20251207 构建，`realesrgan-x4plus-anime`+`animevideov3` 模型）、sharp 0.35.x、openai npm ≥7.59、python3+Pillow；图像接口为 OpenAI 兼容 edits+transparent+任意 WxH（通用声明路径，未识别域名要能 fallback）。
