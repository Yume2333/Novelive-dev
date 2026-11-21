# 原文导入（TXT/EPUB）可复用资产调研

调研日期 2026-11-21。范围：中文 TXT 章节识别、编码检测、EPUB 解析、段落规整、插图提取、卷/系列识别、广告水印剔除、中文 token 计数，以及 Novelive-legacy `packages/source-import` 的可救回程度。

---

## 一、Legacy `packages/source-import` 救回判定

**总判定：救回价值极高，但要做"减法救回"——骨架整体搬，检测规则换掉，产物模型简化。**

包内约 22k 行（含测试），依赖仅 `chardet@2.2.0`（MIT）、`saxes@6.0.0`（ISC）、`yauzl@3.4.0`（MIT）、内部 contracts/domain。全部 TS、纯内存（bytes in → DTO out），正好符合我们"agent 底座侧 utility process 内纯函数导入"的位置。

### 可直接搬的部分（基本原样）

- `src/txt/decode.ts`（40 行）：封闭标签集 `["utf-8","gb18030","shift_jis"]` + Node `TextDecoder(label,{fatal:true})` 作为唯一存活裁决。Node 24 实测还支持 `big5`/`big5-hkscs`/`euc-jp`/`utf-16le`/`utf-16be`，应在标签集里补 `big5`、`utf-16le`、`utf-16be`（见"冲突与缺口"）。
- `src/txt/encoding.ts`（456 行）：BOM 检测 → ASCII 直通 → chardet 排名 → 每个候选 fatal decode → 确定性质量门 → 自动选或返回 ≤3 个带预览的候选（`decision-required` 结果）。这套"detector 只排名、fatal decode 判存活、质量门否决、不quiet-guess"的设计非常对，直接搬。
- `src/txt/quality.ts`：U+0000 比例 ≤0.02、控制符 ≤0.05、可打印密度 ≥0.8 三道门。
- `src/txt/normalize.ts`（193 行）：BOM 剥离、CRLF/CR→LF、NFC、空行分段、边界裁剪但保留行内空白、每段记 1-based 行区间。
- `src/txt/provenance.ts`（275 行）：段落级 byte-span 溯源（unit→byte 映射 + UTF-8 自同步快路径）。我们的 `source p0012-p0018` 段落引用只需要段落序号，不需要 byte 溯源——**建议降级为段落索引，删掉 byte-span 层**，或留但只存 `{start,end}` 段范围。
- `src/epub/` 全部（约 2.5k 行 + 大量测试）：yauzl 有界 ZIP 打开、container→OPF→spine→nav/NCX 全静态校验后才读正文、`<p>` 正文投影（aside/nav 排除）、`<a href>` 绑定到段落、manifest+spine 双路图发现（cover vs inline）、magic 校验（JPEG/PNG/GIF/WebP）。这套就是"Node 里的 epub2/lingo-parser 正确版"，直接搬。
- `src/limits.ts`：完整输入限额字段集（ZIP 条目数/解压总字节/XML 深度/输出码元数等）。攻击面设计现成。
- `src/errors.ts`：10 个 SOURCE_* 错误码。
- `src/paragraph-ids.ts`：`para_000001` 这种段落 ID mint，正好接我们剧本 `source` 行。

### 要改的部分

- `src/txt/chapters.ts`：**规则太窄必须换**。只认 `^第…章`（中文/阿拉伯两套 family）+ `^chapter N`，且**两套 family 并存直接整体拒绝**（`conflicting-chapter-titles`）。实测：含 `第3章`/`第１０２章`/`第1节`/`序章/番外/终章` 的真实网文文本，legacy 全部拒识。legado 的默认规则集（见下）一份就跑通。→ 保留 `detectTxtChapterSignals` 的签名和 warnings 通道，把 `matchChapterMarker` 换成 legado 式规则表，去掉"family 互斥"和"必须严格连续编号"两个硬拒绝（降级为 warning）。
- EPUB 章候选（`src/epub/chapters.ts`）：按导航项→spine entry 正文段区间映射，遇同 spine entry 双导航条目时第二条丢弃 + warning。可直接搬，但建议补一个"章候选为空时回落到 spine 每 entry 一章"的兜底。
- 公共 API（`src/index.ts`/`types.ts`/`registry.ts`）：`SourceParseRequest` 带 `selectedReferences`/`libraryFileId`/`purpose` 一套是 legacy 的 library/workspace 概念，简化成 `{bytes, format?, encodingOverride?, limits}` 即可；`purpose` 概念去掉（用格式探测：ZIP 魔数→EPUB，否则 TXT）。
- fixture 体系：`src/txt/fixtures.ts`（711 行）+ `encoding-tables.ts`（310 行，Python 生成的 GB18030/Shift-JIS 字表）+ `scripts/generate-encoding-tables.py` 是一套自洽的测试生成管线，测试价值极高，建议连同 `fixtures/` 目录和 vitest 配置一起搬。

---

## 二、各来源资产清单

### 1. legado（阅读 3.0）— GPL-3.0，**只参考不拷**

- 仓库 `github.com/gedoor/legado` 主仓已清空（侵权公告）；分析用 fork `huajideshutiao/legado`（同 GPL-3.0）+ 前身 `gedoor/MyBookshelf`（GPL-3.0）。
- **目录规则全集**（`ui/src/commonMain/composeResources/files/defaultData/txtTocRule.json`，26 条，含启用位/示例/优先级）。这是中文 TXT 章节标题识别的事实标准集合，覆盖：`第X章/节/卷/集/部/篇/回/场/话`（含 〇零一两…壹贰叁…仟 全数字字符集）、`序章|楔子|正文|终章|后记|尾声|番外|简介|前言|文案`、`Chapter|Section|Part|Episode|No.`、纯数字标题（`12`、`一百七十`）、`数字+分隔符+标题`（`1、…`）、`特殊符号标题`（`【第1章…`、`☆、…`、`『…』`）、`书名+（数字）`、`字数分割分节`、`双标题（前向/后向）`、顶格短行、`===标题===`、以及每条都带的反例 lookahead（`节(?!课)`、`集(?!合和)`、`部(?!分赛游)`、`回(?!合来事去)`、`场(?!和合比电是)`、`篇(?!张)`）。`.{0,30}$` 行长上限防误吞正文。
- **目录解析算法**（`data/.../fileBook/TextFileCore.kt`）：流式 8KB 块扫全文、正则 `findAll` 带超时（防病态规则 ReDoS）、块前无标题的内容先作"前言"章、超长章（默认 100KB）自动按字数再分小节（`splitLongChapter`/`maxLengthWithToc=102400`）。规则选择策略：`getTocRules().reversed()` 取启用的规则逐个试算，先用命中数最多的规则（贪心"有效命中最多"选规则）——实测能自动适应 `第X章` / `第X节` / `Chapter N` 混排。
- **替换净化（去广告）机制**（`data/.../entities/ReplaceRule.kt` + `ReplaceRuleDao`）：`{name, group, pattern, replacement, scope, scopeTitle, scopeContent, excludeScope, enable, isRegex}` 的规则表，作用于标题/正文可分，社区有大量共享 JSON 规则（笔趣阁类水印行）。规则内容本身是针对网页抓取源的，对本地 TXT 需要另写一小套"常见水印行"规则（见缺口）。
- `EncodingDetect`：JVM 端就是 icu4j CharsetDetector，Node 侧等价物是 chardet/jschardet（见编码节）。

**判决：GPL → 代码一行不拷；但 26 条默认目录正则（数据不是代码）+ "多规则试算选命中最多"的策略 + "超长章再分 + 首章前言兜底"的算法思路，移植改写。正则语义转成 JS 时要测 lookbehind（Node 24 支持完好）和 `(?m)` flag。**

### 2. MyBookshelf（阅读 2.0 前身）— GPL-3.0，**只参考**

- `BookshelfHelp.java`：`chapterNamePattern = ^(.*?第([\d零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟０-９\s]+)[章节篇回集])[、，。　：:.\s]*`——含全角数字 `０-９`，legacy legado 字符集里没全角数字（靠 `\d` 在 Unicode 模式外也不匹配全角；JS `/\d/` 只认 ASCII，**我们的正则要把 `０-９` 显式加进字符类**，我的样例测试已验证 `第１０２章` 需要它）。
- `BookshelfHelp.getPureChapterName`：从标题剥离"第X章"前缀和尾部括号注记拿纯标题；`name.matches("第.*?卷.*?第.*[章节回]")` 识别"卷下嵌章"行——可用于卷/章两级检测。

### 3. TRNovel（yexiyue/TRNovel）— MIT（需复核），**参考其规则数据模型**

- 文档 `yexiyue.github.io/TRNovel/reference/toc-rules/`：把目录规则建成 `{name, pattern(regex), example, serialNumber, maxTitleLen, isVolume, isExclude, enable}` 的结构，`isVolume` 和 `isExclude`（排除规则，如 `^第?…(部门|部队|部分|节课|集合)`）两个字段比 legado 的纯启用/禁用更干净——建议我们的规则表直接采用 `kind: "chapter"|"volume"|"exclude"` 三值字段，比 legado 的扁平列表好维护。其"标题必须独立成行、全角空格缩进视为正文、行长上限"三条反歧义规则和 legado 一致。

### 4. Calibre — GPL-3.0，**只参考**

- `src/calibre/ebooks/conversion/plumber.py:412`：默认章检测是 XPath `//*[((name()='h1' or name()='h2') and re:test(., '\s*((chapter|book|section|part)\s+)|((prolog|prologue|epilogue)(\s+|$))', 'i')) or @class='chapter']`——**EPUB 侧"导航缺失时按 heading 标签 + 英文关键词"兜底**的思路可搬（我们的 EPUB 兜底可用 spine 分段 + h1-h3 首行）。
- `structure.py:60 detect_chapters` + `create_toc_from_links`：还有一个完全独立的兜底——**按文档内 `<a href>` 目录页链接建 TOC**。中文网文 EPUB 常见"目录页+锚点"结构，这条兜底对无 nav/NCX 的野生 EPUB 有用。
- `txt_input.py`：TXT 输入的 heuristic 模式只做斜体/章标题排版标记，对中文无价值。

### 5. foliate-js — MIT，**可小量移植**

- `foliate-js/epub.js`（1083 行）：NS 表、`resolveURL`（epub 内相对 href 解析）、`parseNav`（EPUB3 nav 的 `toc|page-list|landmarks|其他` 四分）、NCX 解析、`page-list`/`landmarks`/`calibre_bookmarks.txt` 提取、`sections` 与 spine 的映射、`linear="no"` 处理。它是 renderer 取向（按需 loadText/loadBlob 回调），不是提取取向。
- **可移植**：`parseNav`/`parseOL`/`parseNCX` 三块（约 150 行）比我们 legacy `navigation.ts`（222 行）多了 page-list/landmarks 分类，可参考补齐导航类型；`resolveURL` 的 base 处理可对照 legacy `path.ts`。

### 6. @lingo-reader/epub-parser@0.4.6 — MIT，**可用但不必**

- 纯 JS + fflate/jszip，无 DOM 依赖（自带 XML 解析），`initEpubFile(path)` → `getSpine()/getToc()/getManifest()/loadChapter(id)/getCoverImage()/resolveHref()`，还带加密 EPUB 解密钩子（`rsaPrivateKey`/`aesSymmetricKey`）和 SMIL 音频。
- 问题：`loadChapter` 返回 HTML 字符串不是段落流，插图以"保存到 resourceSaveDir"方式落盘；更新快（2026-04 发版）但生态小。
- **判决：不引入**。我们 legacy 的 EPUB 管线（段落投影+图清单+provenance）覆盖得更准，它唯一独有的是加密 EPUB 解密——中文书源 EPUB 极少加密，不值得为它换底座。备查。

### 7. epub2@3.0.2（bluelovers fork）— ISC，**不要**

- API 很糙：`getChapterAsync(chapterId)` 返回整章 HTML 字符串；依赖 adm-zip+xml2js+bluebird，错误处理弱；2023 年后停更。无任何领先 legacy 之处。

### 8. epub.js（futurepress/epubjs）— FreeBSD，**不要**

- 浏览器渲染取向，重（需要 DOM/URL/blob），章节=渲染单位不是提取单位。

### 9. 编码检测库对比（实测）

| 库 | license | 实测（`/tmp/enc-test.mjs`） |
|---|---|---|
| `chardet@2.2.0` | MIT | UTF-8 中文@100、GB18030@100、Big5@100、短 GBK 样本压到 25 分以下→正确触发"低置信需确认"；能区分 GB18030/Big5/Shift_JIS/EUC-KR |
| `jschardet@4.1.0` | 0BSD | GB18030 只给 0.45、Big5 0.35、短样本 0.03——置信度整体偏低，难设阈值 |
| `iconv-lite@0.7.3` | MIT | 纯编解码，不需要（Node TextDecoder 全包） |
| `encoding-japanese@2.5.0` | MIT | 日文专用，中文书源用不上 |

**判决：沿用 legacy 的 chardet + Node fatal TextDecoder 组合，标签集扩到 `utf-8 | gb18030 | big5 | shift_jis | utf-16le | utf-16be`。** GBK 用 `gb18030` 解码即可（GBK⊂GB18030）；UTF-16 靠 BOM 提前拦截（BOM 规则 legacy 已有），不进统计竞争。

### 10. token 计数

- 我们的模型是创作者自配（OpenAI 兼容/Anthropic/其他），**跨 provider 的精确 token 数拿不到也不该追**。
- `js-tiktoken`（MIT）/`gpt-tokenizer`（MIT）只覆盖 OpenAI 系；`@anthropic-ai/tokenizer`（Apache-2.0）覆盖 Claude；国产模型（deepseek/qwen）各自 tokenizer 无 npm 官方包。
- **判决：只参考，不落库**。中文上下文预算用"字符数≈token 粗估"（中文≈1.5-2 token/字，按文档里"按章切段预览"只需要数量级），或者在 `project.db` 里直接记 API 返回的 usage 值做真实统计（我们用量统计面板本来就是记 usage）。**不引入任何 tokenizer 依赖**。

---

## 三、落地建议（接到我们设计的哪一层）

导入模块放 agent 底座的 `source/` 侧，产物是 `NormalizedSourceDocument`（段落数组+章候选+导航+图候选+元数据），写进 `source/` 目录 + `project.db`；导入向导核对章划分对应 legacy 的 `ChapterCandidate[]`+warnings 通道，`decision-required` 编码结果对应向导的"确认编码"步骤。

- **直接拷贝**（license 均 MIT/ISC/0BSD，无 copyleft）：legacy `packages/source-import` 的 txt/{decode,encoding,quality,normalize,provenance,fixtures}、epub/ 全目录、media/{raster-magic,reference-images}、limits、errors、paragraph-ids、exact-cover、chapter-candidates、encoding-tables + 生成脚本 + fixtures + 全部测试。删 `selectedReferences`/libraryFileId/purpose 概念，简化 `SourceParseRequest`。
- **移植改写**：legado 26 条目录正则 → 改写成 `ChapterRule[] {name, pattern, kind: chapter|volume|exclude, example, enable}`（TRNovel 数据模型），合入 `txt/chapters.ts` 的候选生成；legado 的"多规则试算选命中最多 + 前言兜底 + 超长章拆分"算法；MyBookshelf 全角数字字符类。
- **只参考**：Calibre 的 h1/h2+关键词兜底与目录页链接兜底（EPUB 无导航时）；lingo-reader 的加密 EPUB 钩子和 API 形状。
- **不要**：epub2、epub.js、iconv-lite、jschardet、任何 tokenizer 依赖、foliate-js 整体（仅参考 parseNav）。

## 四、和我们现有设计冲突或缺口

1. **章检测规则太窄是 legacy 最大缺口**（实测验证）：family 互斥 + 强制连续编号会让几乎所有真实网文 TXT 拒识；必须换成 legado 式多规则表。
2. **编码标签集缺 Big5/UTF-16**：legacy 只支持 utf-8/gb18030/shift_jis；台版书源 Big5 和国产阅读器导出的 UTF-16 会 `no-surviving-decoder`。扩标签集即可（Node 原生支持，无成本）。
3. **段落-ID 语义对齐**：legacy mint `para_000001`，我们剧本 `source p0012-p0018` 用 `p%04d` 段落号——天然对应，无需改。
4. **缺"卷"检测**：`docs/work-format.md` 的 系列→卷→作品→章 四级，legacy 只出平铺章候选。`第X卷`/`第X部`/`上中下卷` 行（legado 规则已含）应单独标 `kind:"volume"`，在导入向导里作为分卷建议给整理角色（文档里本来就设计了这个角色职责）。
5. **去广告/水印行**：legado 的 ReplaceRule 机制（pattern/replacement/isRegex/scope）可降为导入侧的固定"净化管线"步骤：一组内置常见水印正则（书源名/网址/`www.`/`请收藏`/`记住本站`/`最新网址`/域名行/分隔装饰行）+ 每作品可加的自定义规则。不要做成用户共享规则系统——我们不用它浏览网页源。
6. **超长章与前言兜底**：legado 的 100KB 章拆分和"首标题前内容=前言"两条规则直接解决 pipeline 里"超长章节切段预览，不截断"的落点——切段策略按段落边界，不按字节。
7. **EPUB 兜底链缺**：nav→NCX→(h1/h2+关键词)→(spine 每 entry 一章) 四级；legacy 只做了前两级+候选为空警告，后两级建议补（Calibre 思路）。
8. **冲突**：legacy `SourceBytesInput.purpose`（"txt"/"epub"）为必填，我们按 magic 探测（`PK\x03\x04`+mimetype）更顺；`SourceParseRequest.selectedReferences` 概念（用户选参考图）在我们设计里属于"已有参考图"设置，不在导入管线里。
