# zh-tokens（R2 中文 token/字系数实测）

验证内容：11 个分词器对网文/红楼/`.nvs`/bible/英文 prompt/3k 章的实测 token 数，算出「CJK字数×k + 非CJK字节÷4」分档 k 表（gap-ledger 核实结果 6、B40）。支撑报告 `.workflow/research/refs/ext-2026-11-r2-zh-tokens.md`。

文件：`measure.py`（计量脚本）、`results/summary.md`+`tokens.json`（全部实测数字）、`corpus/` 三个自写夹具：`nvs_sample.nvs`（按 work-format 手写的 40 行剧本）、`bible_big.json`（30 角色+15 地点设定集）、`prompt_en.txt`（英文写手系统提示模板）。大语料 `webnovel.txt`/`hongloumeng.txt`/`chapter_3k.txt`/`book_300k.txt`（公开网文样本与公有领域文本，~百 KB-MB 级）未拷——按归档规则「长文本不进 repo」，重测时从 summary.md 里写的来源重新下（HF `qwertyuiopasdfg/Chinese-web-novel`、GitHub `OahzOb/n-gram-statistic-model`），或换任意中文散文。

重跑：`pip install tiktoken tokenizers`（实测 tiktoken 0.14.0、tokenizers 0.23.3），把各 `tokenizer.json` 放进 `hf/models--<repo>/snapshots/<sha>/tokenizer.json`（`measure.py` 按此 HF 缓存布局读；repo 清单见 summary.md），`cd .. && python3 measure.py`（读 `corpus/`、写 `results/tokens.json`）。

第三方依赖：tiktoken（MIT，OpenAI）、`tokenizers`（Apache-2.0，HF）。tokenizer.json 权重文件来自各 HF 仓库（见 summary.md 逐行来源与 commit）。
