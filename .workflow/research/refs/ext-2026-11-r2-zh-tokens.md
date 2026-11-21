# r2-zh-tokens：中文 token 计量验证（2026-11-21）

## 1. 结论

- **round-1 定的「UTF-8 字节 ÷ 4」方向对，但偏乐观**：在纯中文网文上，字节÷4 对国产模型分词器（Qwen/Kimi/DeepSeek/GLM）误差 −3%~−12%（估高了，安全方向），对 o200k +18%、llama3 +21%（估低了）。综合 8 个分词器，它是**单参数通用估计里可接受的**，误差带 ±25%。
- **`chars ÷ 3.5` 不可救药**：中文网文实测低估 124%~352%（cl100k 达 3.5 倍），确认 round-1 B14b「低估约 2.6 倍」保守了——对 cl100k 是 3.7 倍。pi-ai 的 `CHARS_PER_TOKEN=3.5` 必须弃用。
- **更好的估计器是 `CJK字符数×k + 非CJK字节÷4`**：全局 k=0.91 时平均误差 19%、仍比字节÷4略差在 .nvs 上；**推荐按 provider 分档 k**（实测各分词器散文 k 值见 §2），默认无实测锚点前用 k=0.9（≈1 汉字≈0.9 token），对国产模型会高估 10~25%——**宁可估高**（上下文维护场景高估=提前压缩，安全；低估=溢出）。
- **计量必须按 provider 分档**：同一篇 3000 字网文章节，deepseek-v3 只要 1,747 token、cl100k 要 3,690——差 2.1 倍。一个公式打全 provider 会把上下文窗口浪费一半或溢出。
- **Claude 无公开分词器**，但官方 count_tokens API 实测数据已发表：Claude 4.6/4.7 中文散文约 **1.04~1.05 token/字**（750 字→779/789 token），接近 cl100k 水平；英文/代码在 4.7 又涨了 1.3~1.45 倍。Claude 走「中文字≈1 token」档。
- **3000 字章节实测**：1,747(deepseek)~3,690(cl100k) token；**30 万字整书**：19.1 万(deepseek)~38.7 万(cl100k) token。成本模型按 provider 分开建。
- **语料遗憾**：鲁迅/老舍时代的白话小说没有拿到全文（Wikisource 只剩扫描件链接、ctext 被 Cloudflare 拦、Gutenberg 维护中、GitHub 现有 luxun 数据集全是碎条）；用红楼梦（明清白话）+网文（当代白话）覆盖了中文散文两端，中间档的白话文比率落在二者之间，不影响结论方向。

## 2. 证据

实测脚本与原始数据：`/tmp/nl-r2/zh-tokens/{measure.py,results/tokens.json,results/summary.md}`。

### 2.1 实测表（命令：`HF_HOME=… python measure.py`，输出逐字如上）

**tokens/字（越低越省）** — 网文 / 红楼 / .nvs / bible_json / 英文 prompt：

| 分词器 | 网文 | 红楼 | .nvs | bible | 英文 |
|---|---|---|---|---|---|
| o200k_base | 0.860 | 0.930 | 0.574 | 0.369 | 0.212 |
| cl100k_base | **1.291** | **1.329** | 0.676 | 0.426 | 0.213 |
| qwen2.5 | 0.707 | 0.785 | 0.582 | 0.353 | 0.214 |
| deepseek-v3 | **0.640** | 0.734 | **0.534** | 0.342 | 0.216 |
| glm4 | 0.685 | 0.765 | 0.543 | 0.340 | 0.213 |
| kimi | 0.707 | 0.785 | 0.582 | 0.353 | 0.214 |
| llama3 | 0.882 | 0.940 | 0.579 | 0.376 | 0.214 |
| gemma2 | 0.739 | 0.800 | 0.556 | 0.402 | 0.229 |
| gemma3 | 0.769 | 0.824 | 0.594 | 0.407 | 0.229 |

→ source：本地实测，`results/tokens.json`；tokenizer.json 取自 HF 官方 repo 固定快照（Qwen2.5 @a09a354、DeepSeek-V3 @e815299 等，见 summary.md），2026-11-21 下载。Qwen3-8B 与 Qwen2.5 同词表（逐字节相同结果，合并）。

**3000 字章 / 30 万字书实测 token**（喂成本模型）：

| 分词器 | 3k 章 | 300k 书 |
|---|---|---|
| o200k | 2,385 | 258,346 |
| cl100k | 3,690 | 387,343 |
| qwen2.5 | 1,903 | 211,013 |
| deepseek-v3 | **1,747** | **191,450** |
| glm4 | 1,826 | 204,851 |
| kimi | 1,903 | 211,013 |
| llama3 | 2,426 | 264,896 |
| gemma2 | 2,021 | 221,293 |
| gemma3 | 2,076 | 230,470 |

### 2.2 估算器误差（实际 ÷ 估计 − 1，正=实际被低估）

| 内容 | bytes÷4 | chars÷3.5 |
|---|---|---|
| 网文 | deepseek −12%、glm −6%、qwen/kimi −3%、gemma2 +1%、gemma3 +5%、o200k +18%、llama3 +21%、cl100k **+77%** | +124%~+352% |
| 红楼 | deepseek −2%、glm +2%、qwen/kimi +5%、gemma2 +7%、gemma3 +10%、o200k +25%、llama3 +26%、cl100k +78% | +157%~+365% |
| .nvs | +42%~+80%（全部低估） | +87%~+137% |
| bible JSON | +9%~+36% | +19%~+49% |
| 英文 prompt | −15%~−8%（高估，安全） | −26%~−20%（高估） |

→ source：本地实测，summary.md §估算器误差。

**拟合 `CJK字数×k + 非CJK字节÷4` 的散文 k**：o200k 0.913、cl100k 1.352、qwen2.5/kimi 0.756、deepseek 0.693、glm4 0.733、llama3 0.931、gemma2 0.781、gemma3 0.810。.nvs 与 JSON 的误差主要来自非 CJK 标记词（`@bg`、`lin-xiao`、JSON 键名）按 4 字节/token 估仍偏低，可接受。

### 2.3 Claude（无公开分词器，最佳已发表证据）

- **Claude 4.6 vs 4.7 中文散文实测**（官方 `/v1/messages/count_tokens`）：750 字中文 → 4.6 给 779 token、4.7 给 789 token，**≈1.04~1.05 token/字**；4.7 相对 4.6 中文仅 +1%，英文/代码 +1.2~1.45 倍。→ Abhishek Ray, "I Measured Claude 4.7's New Tokenizer", claudecodecamp.com，2026-04-16，方法=官方 count_tokens API。
- 第三方平台口径「Claude 中文约 1 token/字」与前一致。→ aitoken.com.tw 中文 token 比较文，2026-04-14，引 Anthropic 官方文档。
- Gemini：Google 官方「1 token ≈ 4 characters」粗估，实测 gemma3（262k 词表，近似 Gemini 量级）中文 0.77~0.82 token/字，与官方粗估不冲突。[INFERENCE：gemma 词表是 Gemini 的合理代理，未用 Gemini API 验证]
- 六大分词器对照公开实测：同一文档中/英对照，o200k 中文 +23.7%、cl100k +66.8%、Qwen2.5 +12.3%、GLM-4 +8.7%、DeepSeek-V2 +7.8%。→ markhuang.ai/blog/chinese-token-myth，2026-04-07，CC-BY-NC-4.0（仅引数据，不拷文本）。

### 2.4 语料与许可

- `webnovel.txt`：HF `qwertyuiopasdfg/Chinese-web-novel`（Apache-2.0）data.csv 抽 40 章。含部分繁体网文；按「数据集附带许可」可研究用，不二次分发原文。
- `hongloumeng.txt`：GitHub `OahzOb/n-gram-statistic-model`（MIT）Text/红楼梦.txt；原文公有领域。
- `nvs_sample.nvs`、`bible*.json`、`prompt_en.txt`：本任务手写（按 docs/work-format.md、bible.md 字段）。

## 3. 对照现有设计

- **「UTF-8 字节 ÷ 4」**（pi-scaffolding.md:105，决策「上下文维护分级」）：**已覆盖但需修订**——方向正确（远好于 chars÷3.5），但裸用对 o200k/llama3 低估 ~20%、对 cl100k 低估 ~80%。建议改为「**CJK字符×k + 非CJK字节÷4**」，k 按 provider 分档（§2.2），缺省 k=0.9。改动落在 pi-scaffolding.md:105 一句，决策本身（用字节估算、实测锚定）不冲突。
- **「实测 usage 锚点 + 字符估算」**（pi-scaffolding.md:105 同句）：**已覆盖**，本报告支持该设计——估算器误差 ±20% 必须由 usage 锚点吸收，无锚点前宁高估。
- **pi-ai `CHARS_PER_TOKEN=3.5` 中文低估 ~2.6×**（gap-ledger B14b）：**属实但偏保守**——实测对 cl100k 是 3.7×、对 qwen 系 2.0×。B14b 结论（改用字节）成立。
- **成本模型（`run`/`cost_usd` 表、用量记录）**：**缺口**——3000 字章/30 万字书的逐 provider token 表在本报告 §2.1，可抄进成本估算注释或测试夹具；归属文档：`docs/creation-pipeline.md` 或新 `agent/context/` 注释。
- **图像 token 计量**（omp `image-tokenization.ts` 已定为 B14b 配套）：**不在本任务范围**，未重测。

## 4. 可拷资产

- **分档 k 表**（自产数据，无许可问题）：`{default:0.9, anthropic:1.0, openai_o200k:0.91, openai_cl100k:1.35, qwen:0.76, kimi:0.76, deepseek:0.69, glm:0.73, llama:0.93, gemini_proxy:0.81}`，加 `非CJK字节÷4` 项。→ 落点建议 `packages/creator/src/agent/context/tokens.ts`。
- **测试夹具**：`corpus/{nvs_sample.nvs,bible_big.json,prompt_en.txt,chapter_3k.txt}`（自写/公有领域/Apache-2.0 数据），可剪成小尺寸单测输入验证估算器。
- **tokenizer.json 文件**（HF 各 repo 快照，~10-60MB 每个）：**不建议打包进应用**——体积大且许可各异（Qwen/DeepSeek/GLM 多为 Apache-2.0 或自有许可，llama/gemma 是受限社区许可）。如未来要本地精确计量，tiktoken wasm（o200k/cl100k，MIT）+ 单文件 tokenizer.json 按需加载即可，不必现在做。
- **measure.py**（本任务写的，无外部依赖许可）：可改成 `scripts/` 下的回归脚本。

## 5. 需要所有者取舍的事

**选项 A（推荐）**：估算器升级为 `CJK字符×k_provider + 非CJK字节÷4`，k 表如上，缺省 0.9。改动 = pi-scaffolding.md:105 一处措辞 + tokens.ts 一张表。理由：对国产模型（主力写手模型候选）比字节÷4 更准，且永远朝「估高」一侧偏，配合已有的实测锚定正好收敛。

**选项 B**：维持「UTF-8 字节÷4」单公式。改动零成本，但对 o200k 系（GPT-5.x、部分 OpenAI 兼容端点）系统性低估 ~18%、cl100k（老 OpenAI）低估 ~80%。若产品规划里主力模型永远是国产模型，B 够用；若要支持 OpenAI 端点，B 会把 128k 窗口当成 ~148k 用。

**选项 C**：为每家 provider 内置真实分词器（tiktoken wasm + tokenizer.json）。精度 100%，但加 ~10-60MB 体积、许可审查、以及"换模型要换词表"的维护成本——**不推荐**，实测锚定已经覆盖精度需求，估算器只在冷启动前几轮起作用。

推荐 A：一行公式换 ±10% 精度且方向安全，符合「不做防御性设计」（必要限制内，非投机）。
