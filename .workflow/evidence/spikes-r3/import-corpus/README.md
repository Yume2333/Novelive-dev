# import-corpus（R3 导入去风险：TXT 编码 + 章节/卷识别 + EPUB 提取）

验证内容：M1a 导入管线三件套在 37 文件语料+9 文件留出集上的实测——`src/detect.mjs` 纯 Node 编码检测（BOM→ASCII→UTF-16 嗅探→fatal decode→书写系统密度打分→散文形状门，语料 25/25 全对含歧义 Big5，legacy chardet 同文件选错）、`src/split.mjs` `ChapterRule[]` 章/卷切分（主规则取命中最多+序跋番外 aux 并集、裸数字 ≥3 命中门槛、8 条 PURIFY_RULES、MAX_CHAPTER_CHARS 超长章再分）、`src/epub.mjs` nav→ncx→h1/h2→spine 四级兜底（4 种 EPUB 形态全过）。legacy 等价实现做回归基线：UTF-16 全拒、回目书全 `no-chapter-markers`。冻结版留出集 9/9（修复 4 条规则后）。支撑报告 `.workflow/research/refs/ext-2026-11-r3-import-corpus.md`。

文件：`src/{detect,split,epub}.mjs`（三件核心，零依赖可直搬）、`eval_txt.mjs`/`eval_heldout.mjs`（评测架+EXPECTED 表+legacy 等价实现）、`frozen/`（迭代期冻结的 detect/split/epub 副本+两组 SHA256 对照）、`results/`（eval-final/eval-1/eval-after-fix/heldout-frozen/heldout-fixed 逐文件 JSON）、`corpus{,-heldout}/manifest.json`（37+9 文件清单：来源/编码/标题风格/期望章卷数；**语料文本未拷**——真书 5 本公版可 `fetch_corpus.py` 重拉，合成变体 `make_variants.py`/`make_epubs.mjs` 需 `$NL_BOOK` 书文重生成）、`fetch*.py`/`refetch.py`（wikisource 抓取）。`node_modules`、corpus 文本未拷。

重跑：`npm i`（@zip.js/zip.js；chardet 只用于 legacy 对照）→ `python3 make_variants.py`（需 `NL_BOOK=<骆驼祥子 txt>`）→ `node make_epubs.mjs` → `node eval_txt.mjs`；留出集 `node eval_heldout.mjs`（GT 在脚本内正则标注）。真书语料 `python3 fetch_corpus.py && python3 refetch.py`（wikisource，~6s/页）。

第三方依赖：@zip.js/zip.js（EPUB 解包）、chardet（仅 legacy 对照）、python3 stdlib；书文与 wikisource 语料自备。
