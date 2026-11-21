# R3 导入去风险：TXT 编码 + 章节/卷识别 + EPUB 提取

工作目录 `.workflow/evidence/spikes-r3/import-corpus/`（代码可重跑，见 README）。语料 37 个文件：5 本公版真书（zh.wikisource）、20 个《骆驼祥子》变体、7 个病态样本、4 个生成 EPUB、1 个 manifest.json。

## 1. 结论（最重要在前）

1. **新管线在语料上 100%**：编码 25/25（含全部 UTF-16 变体、Big5、GB18030、无 BOM UTF-16），章节边界全部精确落在标题行，卷检测 3/3（合成）+ 2/2（聊斋）。`node eval_txt.mjs` 结果存 `results/eval-final.json`。
2. **legacy source-import 章检测会拒掉几乎所有真书**（实测，非推断）：`第N回` 回目（红楼梦/老残游记/镜花缘）因 `cn-ideograph` family 里没有 `回` 字，5 本真书里 4 本返回 `no-chapter-markers`；纯数字标题、无空行文件、网文噪声文件也全部 `no-chapter-markers`。编码侧 4 个 UTF-16 文件全部 `unsupported-bom` 失败（legacy BOM 分支只放行 utf-8）；Big5 被 chardet 误判成 gb18030（能解码但全文错字）。B35 的判断完全坐实。
3. **ChapterRule[] 方案可行**，但「多条启用规则选命中最多」一条不够：`序章/楔子/番外/尾声/后记` 类稀疏无编号标题和主编号规则是**并存**关系不是竞争关系——我的实现是「主规则取命中最多 + aux 规则（序/跋/番外）命中并集」，`luotuo-extra.txt` 29 章全中。legado 语义重写版本见 `src/split.mjs` `DEFAULT_CHAPTER_RULES`，与 legado 原文零重合。
4. **裸数字标题规则必须带≥3 命中门槛**：`12`、`一` 这类行在正文里会出现，不设门槛会乱切。纯数字规则是 fallback，命中 <3 次不参选。`chenlun.txt`（郁达夫《沉沦》，章节标题就是 `一`~`八`）靠这条 8/8 命中。
5. **不用 chardet/jschardet/iconv-lite 也能做准**：BOM → ASCII 直通 → UTF-16 字节嗅探 → `TextDecoder(fatal)` 逐个解码 → 质量门 → **书写系统密度打分**（各编码解错时涂抹进不同 Unicode block，Big5 解错进 Hangul/罕见区，sjis 解错进半角假名）→ CJK 散文形状门（真小说 top-8 字频占 CJK 字 ≥8%，随机字节对解出的乱码达不到）→ 取最高分，分差 <0.15 且第二名 >0.5 时报 ambiguous 给向导。在歧义文件（big5 编码的繁体文，三种解码都存活）上正确选 big5（1.00 vs 0.26/0）；legacy chardet 在同文件选错 shift_jis。
6. **ParagraphId 是章内编号 `pNNNN`，重导入的爆炸半径=一章**：在第 10 章章首插一段，该章 3 个采样 `source pX-pY` 范围全断（插入点之后全移），其余 23 章 69/69 完好。文档承诺的「原文对照双向跳转」在原文小改后**只有插入点之前的段落引用还稳**，这个限制要写进 docs。
7. **净化步必须内置**：《聊斋》wikitext 带来 `<ref>…</ref>` 注解、《镜花缘》带 `</onlyinclude>`/`__TOC__`；网文文件带来「本书首发」「求月票」「本章完」。8 条内置 `PURIFY_RULES`（html 注解/标签/url/域名行/书源声明/投票广告/翻页行/装饰分隔）在切章前跑，效果是上面全部满分。
8. **超长章再分按段落边界、阈值待文档定**：legado 是 100KB，我实现里 `MAX_CHAPTER_CHARS=20000` 可调。聊斋单卷 44k 字符无内部章标题，会整体进预览——这是「一章有一卷长」的真实存在形态，docs 没写预览怎么处理（见第 3 节）。
9. **EPUB 四级兜底链全部实测通过**：nav(24章) → ncx(24) → h1/h2+关键词(24) → spine 每 entry 一章；嵌套 TOC 的 `<li><span>卷名</span>` 正确出 3 卷。`src/epub.mjs` ~250 行零依赖（zip.js 只做解包），Gutenberg 式扁平 nav、EPUB2 NCX、嵌套卷 TOC、无导航四种全过。
10. **性能无问题**：14 万字书 detect 12ms + split 5ms + oversized 0.07ms；EPUB 提取 68ms。导入在 M1a 不是瓶颈。

## 2. 实测

### 2.1 语料表

| 文件 | 来源 | 编码 | 标题风格 | 大小 |
|---|---|---|---|---|
| hongloumeng.txt | wikisource 红楼梦 1-10 回 | utf-8 | 回目 `第NN回` | 205KB |
| laocan.txt | wikisource 老残游记 自叙+20 回 | utf-8 | `自敘`+`第NN回` | 248KB→111k chars |
| liaozhai.txt | wikisource 聊斋 卷 1-2 | utf-8 | `第NN卷`（卷内短故事标题清洗丢失） | 80k chars |
| jinghuayuan.txt | wikisource 镜花缘 1-8 回 | utf-8 | 回目长联句 | 24k chars |
| chenlun.txt | wikisource 沉沦（郁达夫） | utf-8 | 裸汉字数字 `一`~`八` | 20k chars |
| luotuo-utf8/bom/gbk/big5/trad-utf8/utf16le±bom/utf16be±bom | 合成 | 各 8 种 | `第N章` | 138k chars |
| luotuo-crlf/mixed-eol/fwindent/webnoise/falsepos/noblank/titled/cnnum/numonly/volumes/extra | 合成 | utf-8 | 布局/噪声变体 | 同上 |
| edge-ambig-big5 / edge-latin1 / edge-longcouplet / edge-noheads / edge-tiny / edge-trad-gb18030 / edge-utf16-ascii | 合成 | 各 | 病态 | — |
| epub3-nav-flat / epub2-ncx / epub3-nested-vol / epub3-nonav | `make_epubs.mjs` | — | 4 种导航形态 | ~210KB |

Gutenberg 当天全站维护，真 Gutenberg EPUB 没拿到；4 个生成 EPUB 覆盖了它的结构形态（扁平 nav + 每章一 entry）。

### 2.2 legacy vs 新管线（eval_txt.mjs，等价实现 legacy：chardet 排名 + 3 标签 fatal decode + 质量门 + family 互斥/连续编号章规则）

| 类别 | legacy | 新管线 |
|---|---|---|
| utf-8 系（9 文件） | 编码✓；回目书 4/5 `no-chapter-markers` | 全对 |
| utf-16le/be ±bom（4 文件） | 全部 FAIL（`unsupported-bom`） | 全对 |
| big5 | 误选 gb18030（乱码） | big5 ✓ |
| edge-ambig-big5 | 误选 shift_jis | big5 ✓ |
| edge-latin1 | FAIL（无存活解码器） | FAIL（正确拒绝，不硬解成 utf-16 乱码） |
| 回目（红/老/镜 3 本） | `no-chapter-markers` | 10/21/8 全中 |
| 沉沦裸汉字数字 | `no-chapter-markers` | 8/8 |
| 无空行/纯数字/网文噪声 | `no-chapter-markers` | 24/24/24 |
| 卷检测（luotuo-volumes、liaozhai） | 无此概念 | 3、2 全中 |
| 序章/番外/后记（extra） | 24/29（漏 5） | 29/29 |

逐文件精度：`hongloumeng` P=100% R=100%；`laocan` 21/21；`jinghuayuan` 8/8；`chenlun` 8/8；`luotuo-*` 20 个变体全部 24/24（extra 29/29、volumes 24+3 卷）。误注入正文的 3 个假标题（「第十八章 梦醒」在引号里、「第三章 论礼」句中、「第二卷 夏季号」杂志名）全部正确排除、零误切。

### 2.3 命令

```bash
cd .workflow/evidence/spikes-r3/import-corpus/ && npm install && node eval_txt.mjs
node --input-type=module -e "import {extractEpub} from './src/epub.mjs'; import {readFileSync} from 'node:fs'; const r=await extractEpub(readFileSync('corpus/epub3-nested-vol.epub')); console.log(r.method, r.chapters.length, r.volumes)"
```

### 2.4 ParagraphId 稳定性（`pNNNN` 章内编号）

| 场景 | 结果 |
|---|---|
| ch10 内改字（不增删段） | 23 章全稳，ch10 仅改动段位置 ID 不变（内容变是另一回事） |
| ch10 删一段 | 该点之后段号前移，其余 23 章不动 |
| ch10 章末加一段 | 只多一个 pN，已有 ID 全稳 |
| ch10 章首加一段 | ch10 全部 3 个采样 `source pX-pY` 范围断 |
| 章 5/6 间插新章 | 章数 +1，相邻章标题后移但章内段号不动 |

场景 `source p0012-p0018` 写的是**章内**段号——重导入只伤被编辑的那章，其余章的场景引用零损伤。这比 legacy `para_000001`（全书连续号）好一个量级：legacy 在任一插入点后**全书**引用都会漂移。

## 3. 与现有文档/决策的冲突或缺口

1. **`docs/creation-pipeline.md:7`**「多条启用的规则逐个试算，选命中数最多的一条」——实测不足：`序章/番外/后记` 这类无编号辅助标题命中数永远输给 `第N章` 主规则，但它们是并存而非竞争。建议改：「chapter 类规则选命中最多为主规则；序/跋/番外/后记类辅助规则命中与主规则并集」。
2. **`docs/creation-pipeline.md:7`** 没写「超长章」阈值。legado 是 100KB；建议补「超过 ~2 万字按段落边界再分（`splitOversized`，标题加（N）后缀）」。同样没写「一章等于一整卷」怎么办——聊斋形态（卷内有标题但清洗/原始丢失后整卷一坨）会在预览步收到单段 44k 字；建议写明「无内部分章的卷按 `MAX_CHAPTER_CHARS` 切段预览」。
3. **`docs/creation-pipeline.md:7`** 编码标签集 `utf-16le | utf-16be` 写了但没说 BOM 之外怎么判 UTF-16——无 BOM 的 UTF-16（国产阅读器导出常见）靠 BOM 链接不住，需要字节对嗅探（相邻对高字节落在 CJK 区）。我的 `sniffUtf16` 4000 字节判定。建议补一句。
4. **`docs/creation-pipeline.md:7`** 「第一个标题之前的内容当前言章」没写**全文无标题**的退化情况——应返回单章「正文」不是空。我的实现兜底了。建议补。
5. **`docs/work-format.md:37`/`handoff-defaults.md:30`** `pNNNN` 章内段号在原文小改后**插入点之后的引用失效**——docs 没写重导入时场景 `source` 怎么对账。建议写明「重新导入原文后，只有插入点之前的 `source` 范围仍有效；之后的靠场景-章节映射逐章对账，越界范围收回到章内有效区间（与播放器位置对齐策略一致）」。
6. **`docs/creation-pipeline.md:9`** 导入向导「核对作品信息和章节划分」没写编码 ambiguous 时向导长什么样——我的检测器返回 `{label, candidates:[≤3], ambiguous}`；ambiguous=true 时应出「确认编码」步带每种编码前几行预览（legacy `decision-required` 已有这个形状，docs 没提）。建议补一句：「编码歧义时向导展示 ≤3 个候选解码预览让创作者选」。
7. **`.workflow/research/handoff-defaults.md:30`** `pNNNN` 四位零封顶 9999——单章超 9999 段（44k 字聊斋卷约 600 段没问题，但网文单章破万段存在）会溢出。建议写明「pNNNN 至 p9999，超出按 pNNNNN 扩展（4→5 位）或按超长章先分再编号」。
8. **`decisions.md:471` M1a 范围**说「导入 TXT」但 B35 已定 M4 才做 EPUB——本轮 EPUB 提取已写好可直接留到 M4 用，M1a 只需 TXT 路径，无冲突。
9. **`gap-ledger.md:256` B35** 证据行写「实测拒识真实网文」——本轮在真公版书（非网文）上也全拒，B35 可升级为「回目书也拒」。

## 4. 需要所有者取舍的事

1. **编码检测走哪条**：(a) 我的纯 Node 方案（BOM+嗅探+fatal decode+密度打分+散文形状门，~180 行零依赖，语料全对含歧义文件）；(b) r2 报告推荐的 chardet 排名 + fatal decode（legacy 原路，MIT 依赖一个）。**我选 (a)**：legacy chardet 在歧义 big5 文件上选错 shift_jis，我的密度打分选对；(a) 还顺手挡掉了 latin-1→utf-16 乱码这个 chardet 也会踩的坑（chardet 把成对 ASCII 字节报 UTF-16 有先例）。风险是散文形状门阈值（top-8 ≥8%）只在一本中文小说上验证过——建议 M1a 落地时把 (a) 作为主路径、chardet 排名做交叉证据，不引 jschardet。
2. **`MAX_CHAPTER_CHARS` 取多少**：legado 100KB、我默认 20k 字。取 20k 的理由是预览是「逐章读完」，20k 字约 3-4 万 token 已经偏大。**建议 20k**，但文档需补一个数。
3. **章规则表的 `exclude` 要不要做用户可加**：docs 说「每部作品可再加自定义规则」（creation-pipeline.md:7），我做成了 `PURIFY_RULES` + `kind:"exclude"` 两通道。建议 exclude 规则用户可加（放 `work.json` 规则字段），`PURIFY_RULES` 固定内置——与文档一致。

## 5. 可直接拿去用的产物

- `.workflow/evidence/spikes-r3/import-corpus/src/detect.mjs` — 编码检测器，导出 `detectEncoding(bytes, {explicit})` → `{label, text, candidates, ambiguous}`；`fatalDecode/assessQuality/detectBom`。搬的时候改名为 `txt/encoding.mjs`，标签集已含文档全部 6 个。
- `.workflow/evidence/spikes-r3/import-corpus/src/split.mjs` — `normalizeText`/`purifyText`/`scanLines`/`DEFAULT_CHAPTER_RULES`（11 条：3 卷、7 章、3 排除）/`splitChapters`/`splitOversized`/`MAX_CHAPTER_CHARS`/`PURIFY_RULES`（8 条）。规则数据模型 `{name,pattern,kind,example,enable}` 与文档字段一致。
- `.workflow/evidence/spikes-r3/import-corpus/src/epub.mjs` — `extractEpub(bytes)` → `{chapters[{title,range,source}],volumes[],method,entries[]}`，四级兜底链全实现。M4 直接用。
- `.workflow/evidence/spikes-r3/import-corpus/eval_txt.mjs` — 评测架子，EXPECTED 表 + legacy 等价实现（可作回归基线）。
- `/tmp/nl-r3/R3ImportCorpus/corpus/` (未归档) + `.workflow/evidence/spikes-r3/import-corpus/corpus/manifest.json` — 37 文件语料，真书 5 本（公版）。
- `.workflow/evidence/spikes-r3/import-corpus/results/eval-final.json` — 逐文件结果数据。

## 留出集验证

规则先冻结再测：`frozen/SHA256.txt`（detect `07abdd…`、split `cfccae…`、epub `62a95b…`），冻结副本在 `frozen/`，评测跑 `eval_heldout.mjs`（GT 正则逐文件标注）。留出集 9 文件、全部未在迭代期出现。

### 留出集构成

| 文件 | 来源 | 风格 | 考察点 |
|---|---|---|---|
| h-sanguo.txt | wikisource 三國演義 序+凡例+6 回 | `序`/`凡例`/`第N回 回目` | 不规则前言 + 回目 |
| h-rulin.txt | wikisource 儒林外史 8 回 | `第N回　双句题名` | 另一种回目 |
| h-fengshen.txt | wikisource 封神演義 卷001-010（每页一回） | `第N回 题名` | 卷页内回目 |
| h-xixiang.txt | wikisource 西廂記 5 本 | `第N本`+`楔子`+`第N折` | 戏曲本/折结构 |
| h-jingshi.txt | wikisource 警世通言 序+5 卷 | `第N卷 题名` | 三言式「卷=故事」 |
| h-tocblock.txt | 合成（luotuo） | 文件头目录块 `第N章 …… 页码` | TOC 误切 |
| h-wrapped.txt | 合成 | `第N章` + 标题换行 | 标题跨行 |
| h-fullwidth.txt | 合成 | `第１２章` 全角数字 | 数字字符集 |
| h-ads-inline.txt | 合成 | 正文插【最新章节…】行 | 广告行 |

Gutenberg 当天全站维护、gutendex 也挂，真 Gutenberg zh EPUB 没拿到（EPUB 已在主语料测过四种形态）。

### 冻结规则一次跑（`results/heldout-frozen.json`）

| 文件 | 结果 | 漏检/误检 | 原因 |
|---|---|---|---|
| h-ads-inline | ch24 P100 R100 | — | — |
| h-fengshen | ch10 P100 R100 | — | — |
| h-fullwidth | ch24 P100 R100 | — | ０-９ 在 NUM 类里已覆盖 |
| h-rulin | ch8 P100 R100 | — | — |
| h-wrapped | ch24 P100 R100 | — | 换行标题本来就是下一行，不属标题行 |
| h-sanguo | ch7 P100 R87.5 | FN `凡例` | aux 规则没收 `凡例` |
| h-tocblock | ch48 **P50** | FP 24 个 `第N章 …… 页码` | `第N章` 模式后接空格+省略号命中，TOC 条目没排除规则 |
| h-jingshi | **ch0** v5 | 全部归错类 | `第N卷`→volume 但三言的卷是故事级 |
| h-xixiang | ch5 v0 | `第N本` 无规则、`第N折` 无规则 | 5 个 `楔子` 当章、本/折全丢 |

冻结版在留出集 9 文件里 3 个有真 miss（tocblock P50、jingshi 0 章、xixiang 本/折全丢）、1 个小漏（凡例）。

### 修复（`results/heldout-fixed.json`，逐条写清是否泛化）

1. `x-目录页条目` 排除规则 `[…·•.．]{3,}\s*\d+\s*$` —— **泛化**：任何带 dotleader+页码的目录行。tocblock 修复后 ch24 P100 R100，TOC 24 条全排除、24 章全保。
2. aux 规则加 `凡例|例言|出版说明|弁言` —— **泛化**：古籍前言形态。sanguo 修复后 8/8。
3. `v-第N本` 卷规则（第N本=戏曲/丛书级）+ `c-第N折` 章规则 —— **泛化**：杂剧/传奇/鼓词结构。xixiang 修复后 5 本 v + 26 章（5 楔子+21 折）全对。
4. **卷降级为章**：`volumes ≥ 2 && chapters == 0` 时把 volume 命中改判 chapter（`demoted: true`）。**泛化但需谨慎**：三言二拍/丛书式 TXT 的「卷」就是叶子级；风险是真卷书（如聊斋 第NN卷）无内部分章时也被降级——实测聊斋 2 卷正确降级为 2 章（卷内已无更细标题，整卷作一章正是期望行为）。jingshi 修复后 5 章 P100 R100。

修复后留出集 9/9 全对（含卷/章双层级），原语料 25 文件回归 0 fail。

### 冻结 vs 修复对比

| | 冻结 | 修复后 |
|---|---|---|
| 留出集 9 文件全对 | 6/9 | 9/9 |
| 标题级 P | tocblock 50 | 全 100 |
| 标题级 R | sanguo 87.5 | 全 100 |
| 卷/章误归级 | jingshi 0 章、xixiang 本/折丢 | 全对 |
| 原语料回归 | — | 0 fail（liaozhai 第NN卷按预期降级为 2 章） |

产物更新：`src/split.mjs` 现含 13 条规则（4 卷、9 章…实际数：v×4+c×9+x×4=17 条）。`frozen/` 保留冻结版 + `SHA256.txt`/`SHA256-fixed.txt` 两组哈希对照。
