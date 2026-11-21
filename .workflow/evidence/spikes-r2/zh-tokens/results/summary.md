# zh-tokens 实测汇总

测量时间 2026-11-21。工具：tiktoken 0.14.0（o200k_base/cl100k_base）+ HF tokenizers 0.23.3（离线 tokenizer.json）。

语料（corpus/）：
- webnovel.txt：起点中文网章节样本 40 章（HF `qwertyuiopasdfg/Chinese-web-novel`，Apache-2.0，实为繁/简混合网文），1,015,308 字 / 2,965,727 B
- hongloumeng.txt：红楼梦全文（GitHub `OahzOb/n-gram-statistic-model`，MIT 仓库；曹雪芹 1763 年卒，文本公有领域），878,802 字 / 2,623,046 B
- nvs_sample.nvs：按 docs/work-format.md §场景文件 手写的 40 行 .nvs 剧本，1,277 字 / 1,915 B
- bible_big.json：按 docs/bible.md 字段写的 30 角色+15 地点设定集，38,231 字 / 47,803 B
- prompt_en.txt：英文写手系统提示+图像提示模板，1,146 字 / 1,146 B

tokenizer.json 来源（HF 官方/镜像仓库，2026-11-21）：
- Qwen/Qwen2.5-7B-Instruct @a09a354（vocab 151,665）
- Qwen/Qwen3-8B（与 Qwen2.5 同词表，实测 token 数逐字节相同，合并报告）
- deepseek-ai/DeepSeek-V3 @e815299（vocab 128,815）
- THUDM/GLM-4-9B-0414（vocab 151,343）
- moonshotai/Kimi-Dev-72B（vocab 151,665，与 Qwen 同 BPE 词表，实测相同）
- unsloth/llama-3-8b-Instruct（meta-llama 官方 repo 需授权，unsloth 镜像同文件；vocab 128,256）
- unsloth/gemma-2-9b-it（vocab 256,000）、unsloth/gemma-3-27b-it（vocab 262,145）

## tokens 实测

| 文件 | 字数 | 字节 | o200k | cl100k | qwen2.5 | deepseek-v3 | glm4 | kimi | llama3 | gemma2 | gemma3 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| webnovel | 1,015,308 | 2,965,727 | 873,449 | 1,310,884 | 717,574 | 650,149 | 695,161 | 717,574 | 895,865 | 749,926 | 780,297 |
| hongloumeng | 878,802 | 2,623,046 | 817,510 | 1,167,734 | 690,012 | 645,211 | 672,043 | 690,012 | 826,303 | 703,249 | 724,340 |
| nvs | 1,277 | 1,915 | 733 | 863 | 743 | 682 | 693 | 743 | 740 | 710 | 758 |
| bible_big | 38,231 | 47,803 | 14,101 | 16,290 | 13,484 | 13,074 | 12,991 | 13,484 | 14,368 | 15,370 | 15,578 |
| prompt_en | 1,146 | 1,146 | 243 | 244 | 245 | 247 | 244 | 245 | 245 | 263 | 263 |
| chapter_3k | 3,000 | 8,782 | 2,385 | 3,690 | 1,903 | 1,747 | 1,826 | 1,903 | 2,426 | 2,021 | 2,076 |
| book_300k | 300,000 | 874,780 | 258,346 | 387,343 | 211,013 | 191,450 | 204,851 | 211,013 | 264,896 | 221,293 | 230,470 |

## tokens/字（CJK 散文为主）

| 分词器 | 网文 | 红楼 | 3000 字章 |
|---|---|---|---|
| o200k | 0.860 | 0.930 | 0.795 |
| cl100k | 1.291 | 1.329 | 1.230 |
| qwen2.5 | 0.707 | 0.785 | 0.634 |
| deepseek-v3 | 0.640 | 0.734 | 0.582 |
| glm4 | 0.685 | 0.765 | 0.609 |
| kimi | 0.707 | 0.785 | 0.634 |
| llama3 | 0.882 | 0.940 | 0.809 |
| gemma2 | 0.739 | 0.800 | 0.674 |
| gemma3 | 0.769 | 0.824 | 0.692 |

## 估算器误差（token 实际值相对估计值的偏差 %）

`bytes/4`：网文 o200k +18%、cl100k +77%、qwen -3%、deepseek -12%、glm -6%、kimi -3%、llama3 +21%、gemma2 +1%、gemma3 +5%；英文 prompt -15%~-8%。

`chars/3.5`：网文 +124%~+352%（全面严重低估），英文 -20%~-26%。

`CJK字数×k + 非CJK字节÷4`：全局 k=0.91 时平均误差 19%，.nvs 上 +29~+43%（标记词按字节÷4 估低了）。
按 tokenizer 单独定 k（散文拟合）：o200k 0.913、cl100k 1.352、qwen/kimi 0.756、deepseek 0.693、glm4 0.733、llama3 0.931、gemma2 0.781、gemma3 0.810。
