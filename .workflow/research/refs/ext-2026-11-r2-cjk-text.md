# R2 调研：CJK 文本渲染（禁则 / 注音 / 打字机 / 字体与导出子集）

2026-11-21。目标：确定播放器对白/独白/旁白/字幕四种文本用 Pixi 画布还是 DOM 覆盖层渲染；CJK 禁则、标点压缩、中英混排、注音、逐字出现不跳行、描边质量、2K/4K 表现；可捆绑的 CJK 字体与授权；`.novelive` 包是否内嵌子集字体及代价。

## 1. 结论（最重要的先说）

1. **文本必须用 DOM 覆盖层，不能用 Pixi 文本对象**。实测：Pixi 8.23.0 的 `Text`/`HTMLText` 换行是「任意字符可断」+ 空格/连字符分词，**没有禁则**（行首可出 `。，`「`）；无注音机制；`wordWrap` 对 CJK 依赖 `breakWords:true` 逐字硬切。而 Chromium 156（Electron 45）的 `line-break:strict` + `word-break:break-word` 对全部禁则实测 0 违例，且 `<ruby>`、text-stroke、text-shadow、`text-spacing-trim` 全可用。WebGAL（MPL-2.0，已验证参考）正是「Pixi 舞台 + React DOM 文本框」同构。
2. **逐字打字机不跳行的做法**：两层 DOM——隐藏「占位居」渲染整句撑开排版（`visibility:hidden`），上面叠加同尺寸「显现层」逐字加 `opacity`。实测任意中间帧重排 0 次、字符位置零漂移。这是纯 DOM 方案独有的；Pixi 文本改 `text` 会整体重排换行。
3. **Chromium 156 已内置 CJK 排版**：`line-break:strict`、`text-spacing-trim:space-first`（实测支持 normal/trim-start/space-all/space-first）、`text-autospace:normal`（实测支持 normal/no-autospace，ideograph-alpha 等子值仍无）、`word-break:break-word/auto-phrase` 全可用；`hanging-punctuation` 全系不支持（无关紧要）。不用自己写禁则规则。
4. **描边用 `text-shadow` 不用 `-webkit-text-stroke`**：2× 实测截图比对，text-stroke 在「雨」「璃」「噼」等多笔画字内部糊黑、笔划粗细不匀；`text-shadow:0 1px 2px rgba(0,0,0,.8),0 0 6px rgba(0,0,0,.5)` 边缘最干净。4K 截图文本依旧锐利。
5. **字体默认**：UI 与播放器默认捆绑 **Noto Serif SC**（思源宋体，galgame 对白首选衬线感）+ **Noto Sans SC**（UI/字幕备用），OFL-1.1，fontsource 已分包 woff2。备选风格字：霞鹜文楷（LXGW WenKai，OFL-1.1，楷书）供作品自选主题字。
6. **`.novelive` 不内嵌完整字体**，改为「**导出时按剧本去重字符集自动子集化**」：实测 6131 个不重复字符（≈30 万字长篇的真实去重规模）+ 全部标点拉丁数字 → Noto Serif SC woff2 **4.9 MB**；Noto Sans SC 同条件 **3.4 MB**。用 npm `subset-font`@2.9.0（harfbuzz wasm，MIT，纯 JS 可在创作端跑）实测 37 字子集 0.34 s；6k 字全册子集用 python fonttools 实测 22.7 s（导出时一次性成本，可接受；创作端可改用 subset-font 同质量同算法）。默认作品用应用内置字体不嵌字；作品选了自定义字体才在导出时嵌子集。
7. **需要所有者拍板**：默认正文字体是「思源宋体」还是「思源黑体」；作品自定义字体走「`styles.css` 里 `@font-face` + 导出自动子集嵌入」这一条是否同意（推荐同意）。

## 2. 证据

### 2.1 Chromium/Electron 的 CJK CSS 实测（Playwright Chromium 159.0.8154.6，≈Electron 45 的 Chromium 156）

`CSS.supports` 实测（命令见 2.4 试验）：
- `line-break:strict` → **支持**；`word-break`: normal/keep-all/break-all/break-word/**auto-phrase** 全支持。
- `text-spacing-trim` → 支持 `normal | trim-start | space-all | space-first`；`space-start`/`trim-both`/`trim-end`/`trim-all` 仍不支持（Chrome 123+ 只实现了第一级值，见 Chrome Platform Status 5170044014690304）。
- `text-autospace` → 支持 `normal | no-autospace`；`ideograph-alpha/-numeric/punctuation/insert` 子值不支持。`normal` 已能做中西文间自动空距。
- `hanging-punctuation` → 全值不支持（Chromium 从未实现，仅 Safari 有）。
- `-webkit-text-stroke`、`paint-order:stroke fill` → 支持但质量差（见 2.3）。
- `Intl.Segmenter('zh',{granularity:'grapheme'})` 正常；emoji/组合符正确成簇。

### 2.2 PixiJS 8.23.0 文本能力实测 + 源码级证据

- `CanvasTextMetrics.canBreakChars` 直接 `return true`（`node_modules/pixi.js/lib/scene/text/canvas/CanvasTextMetrics.mjs:299`）；`wordWrap` 的 tokenize 只在空格/`-`(45) ‐(8208) –(8211) —(8212) ­(173) 处断（`utils/textTokenization.mjs:47-57,125`），CJK 走 `wordWrapSplit`→`Intl.Segmenter` 逐字切。**结论：Pixi 无任何禁则表，行首可出 `。` `，` `」` `！`**。
- 实测同一段 230 字剧本：DOM（`line-break:strict`）5 行、行首 0 违例；Pixi `Text` 同宽 5 行、断点完全不同（在第 2/3/4/5 行中腹截断），换行位置不合法式但随机。
- `HTMLText` 走 SVG `<foreignObject>` 栅格化，可套 CSS 但渲染成位图、放大模糊、且每帧重渲成本高；`BitmapText` 需预烘位图字集，CJK 全集不可行。三个方案都不满足禁则+注音。
- 注音：Pixi 无 `<ruby>` 等价物；只能自己叠两个 Text 对象手算定位，成本高于 DOM。

### 2.3 截图比对证据（Playwright 截图 + 视觉复核）

- `dom_1920x1080_200.png`：DOM 覆盖层整句含 `<ruby>蝉<rt>chán</rt></ruby>`、`<em>` 高亮、全角标点——渲染完整、无重影、ruby 清晰。
- `dom_1920x1080_35.png`：打字机第 35 字中途——已显字符位置与全量完全一致（占位居撑开），无跳行无间隙。
- `outline_2x.png`（deviceScaleFactor=2）四种描边对比：纯白最利但对比差；`text-shadow` 干净且分离度好；**`-webkit-text-stroke:1.5px` 在多笔画字内腔糊黑**；四向 text-shadow 偏肉。→ 推荐 `text-shadow` 方案。
- `dom_4k.png`（3840×2160）：DOM 文本矢量渲染依旧锐利，ruby 略软（字号太小所致，非失真）。DOM 覆盖层随分辨率天然无损，无需为 2K/4K 做任何事。

### 2.4 试验环境与可复现命令

工作目录 `/tmp/nl-r2/cjk-text/`（依赖装在 `/tmp/nl-r2/cjk-text/app`）。
- 依赖：`npm install pixi.js@8.23.0 playwright@1.65.1 subset-font@2.9.0`；`uv venv` + `uv pip install fonttools brotli pillow`。
- 静态服务：`cd /tmp/nl-r2/cjk-text/app && python3 -m http.server 8777`。
- CSS 探测：见 `shot.mjs`/`pixi*.mjs`；禁则比对 `kinsoku.mjs`；截图 `shot2.mjs`/`shot4k.mjs`/`outline.mjs`。
- 字体子集实测：`venv` 内 python fonttools `subset.Subsetter().populate(text=6131字)`，`flavor='woff2'`, `layout_features=['*']`。
- 实测值：Noto Serif CJK SC 单字重 OTF 源 **24.5 MB** → 6k 字子集 woff2 **4 877 712 B ≈ 4.9 MB**（22.7 s）；Noto Sans SC（TTC 19.5 MB/单重）→ **3 361 132 B ≈ 3.4 MB**；4.5k 字子集 Serif **3 745 748 B ≈ 3.7 MB**。

### 2.5 字体授权（均核自 LICENSE/OFL.txt 源文件，均 SIL OFL-1.1，与 AGPL-3.0 兼容：OFL 允许随软件捆绑、子集、再发行；唯一要求是保留字名 Reserved Font Name 不可给修改版用——我们只做子集不改动字形，仍可用原名）

| 字体 | 版本/来源 | 授权 | 体积 | 备注 |
|---|---|---|---|---|
| Source Han Serif / Noto Serif CJK SC 思源宋体 | TTC 2.003 (2024-07) 系统包 | OFL-1.1 | 单重 OTF 24.5 MB | galgame 对白首选；fontsource `@fontsource/noto-serif-sc@5.3.1` 已分块 woff2 |
| Source Han Sans / Noto Sans CJK SC 思源黑体 | TTC 2.004 系统包 | OFL-1.1 | 单重 ~19.5 MB | UI/字幕；`@fontsource/noto-sans-sc@5.3.1` |
| 霞鹜文楷 LXGW WenKai | github lxgw/LxgwWenKai | OFL-1.1（含 RFN「霞鹜/LXGW」附加许可允许衍生物续用原名） | 全字 ~20+ MB | 楷书风格，适合作品主题字；`@fontsource/lxgw-wenkai@5.3.0` / `lxgw-wenkai-webfont@1.7.0`(MIT 包装) |
| 得意黑 Smiley Sans | atelier-anchor/smiley-sans | OFL-1.1 | 全字 ~10 MB | 斜体黑，封面/标题向，不建议正文 |
| MiSans / 苹方 | 系统本地 | **非自由**（MiSans 有自定义许可、PingFang 苹果私有） | — | 只能做系统字体回退，**不可捆绑** |

fontsource 包解压体积：`noto-serif-sc` 87 MB / `noto-sans-sc` 75 MB / `lxgw-wenkai` 56 MB（含全部字重全字符分块）；实际打包只需挑 1 个字重的 woff2 分块（Electron 内走 file:// 全部加载，无 HTTP 懒加载，需衡量整包体积）。

## 3. 对照现有设计

| 发现 | 判定 | 依据 |
|---|---|---|
| 舞台层用 PixiJS 8 | 已覆盖 | `docs/player.md:11`、`decisions.md:666` |
| 界面层用 DOM（React） | 已覆盖 | `docs/player.md:11`「界面层仍是 DOM」、`architecture.md:49` |
| 四种文本类型 / 文本标记 / 注音 / 句中停顿变速 | 已覆盖（需求侧） | `docs/player.md:31-47`、`decisions.md:247` |
| **文本具体渲染载体（DOM 覆盖层 vs Pixi Text）** | **缺口** | `docs/player.md:29-47`「文本」节只写能力，未写实现载体；`DESIGN.md:27` 只说对话框内置两皮肤。应在 `docs/player.md` 或 DESIGN 补一句「四种文本与对话框均用 DOM 覆盖层渲染，不进 Pixi 舞台」 |
| CJK 禁则 / 标点压缩 / 中西文自动空距 | **缺口** | 全文档无；建议在 `docs/player.md` 文本节注明依赖 `line-break:strict`+`text-spacing-trim:space-first`+`text-autospace:normal`，不自实现 |
| `<ruby>` 注音实现 | **缺口**（实现层） | `work-format.md:61` 只定语法 `{ruby 读音}字{/ruby}`；实现 = DOM `<ruby><rt>`，应在播放器文本节注明 |
| 逐字出现不跳行（占位层+显现层） | **缺口**（实现层） | `player.md:44-47` 只定义行为；双 span 结构应写进播放器实现约定 |
| 字体选型 fontsource 本地打包 | 部分覆盖 | `architecture.md:52`「fontsource 本地打包，离线可用」、`tokens.css:164` 字体栈已有 `'Noto Sans SC'` 但**无 Serif 正文字体**、无播放器字体约定 |
| 作品自定义字体 | **缺口** | `work-format.md:97` 允许作品写自定义 CSS（`styles.css`），意味着作品可以 `@font-face`，但**没有说字体文件从哪来、是否随包走**。需定：作品可在系列/卷/作品级 `assets/fonts/` 放 woff2，`styles.css` 相对引用；导出自动按全集字符子集化 |
| `.novelive` 内嵌字体 | **缺口/待决策** | `work-format.md:145` 导出不含原文、未提字体；需新增「导出时若作品引用自定义字体，按 `source/`+剧本文本并集字符自动子集成 woff2 随包」 |
| 播放器皮肤 `Work.accent` 随主视觉 | 已覆盖 | `work-format.md:133`、`DESIGN.md:27` |

## 4. 可拷资产

- **字体文件**（均 OFL-1.1，可直接进仓库/随包发行）：
  - `@fontsource/noto-serif-sc@5.3.1` 的 Regular+Bold 两套 woff2（只取需要的字重分块，约 6–10 MB/字重全字符；若按应用内置「常用 ~3500 字」核心子集可压到 ~2 MB/字重）。
  - `@fontsource/noto-sans-sc@5.3.1` Regular woff2 供 UI。
  - `@fontsource/lxgw-wenkai@5.3.0` 供作品主题字备选。
  - 注意 fontsource 全字符分包体积大（见 2.5），建议只拷 woff2 文件 + LICENSE，不整包依赖。
- **子集工具** `subset-font@2.9.0`（MIT，依赖 harfbuzzjs/fontverter/wawoff2，纯 wasm 无原生模块）→ 创作端导出时跑；与 python fonttools 同算法（harfbuzz subset），输出 woff2 质量一致。
- **WebGAL `Stage/TextBox/`**（MPL-2.0，文件级 copyleft）：只参考「DOM 覆盖层 + 按句 compileSentence + 双态」结构，不拷文件——与既定「WebGAL 只参考重写」策略一致（gap-ledger C7/D 区）。
- **排版 CSS 片段**（自写 ~20 行）：`.vn-text{line-break:strict;word-break:break-word;text-spacing-trim:space-first;text-autospace:normal;text-shadow:0 1px 2px rgba(0,0,0,.8),0 0 6px rgba(0,0,0,.5)}` + `.vn-text .ghost{visibility:hidden}` 双层结构（本报告试验页 `test2.html` 即最小实现，~60 行）。

## 5. 需要所有者取舍的事

**取舍 1：默认正文字体用思源宋体还是思源黑体？**
- 选项：(a) 思源宋体 SC——galgame/视觉小说对白主流（柚子社、Key 等多用明朝/宋体系），衬线更衬长篇阅读；(b) 思源黑体 SC——UI 更统一，省一套字体体积；(c) 两者都装，皮肤选项给创作者。
- **推荐 (a)**：正文/对白 Serif，UI 用已有 Sans；体积代价 ~5 MB 子集或 ~8 MB fontsource woff2，可接受。若在意首包体积可 (c) 但默认 Serif。

**取舍 2：`.novelive` 包要不要带字体？**
- 选项：(a) 不带字体，作品只能用应用内置 2–3 套字体（默认 Serif/Sans + 可选文楷），`styles.css` 只能 `font-family` 选它们；(b) 带字体——作品 `styles.css` 可 `@font-face` 引用包内 woff2，导出时按文本并集自动子集；(c) 完全自由但完整字体直拷（体积 20+ MB 不可接受）。
- **推荐 (b)**：自定义标记和作品皮肤已经是「作品自己定义样式」的开放面（`work-format.md:97`），字体是同一逻辑的自然延伸；子集后 3–5 MB 对一部带几百 MB 图片的作品包可忽略；`subset-font` 纯 wasm 在创作端即可跑，无需 Python。

**取舍 3：应用内置字体装全字符还是装核心子集？**
- 选项：(a) fontsource 全字符 woff2（~8–10 MB/字重，简体全集保证任何书名/生僻字都能显示）；(b) 预切「常用 3500+GB2312」核心子集（~2 MB）+ 系统 CJK 回退兜底生僻字。
- **推荐 (a) 但只取 Regular 字重**：Electron 内字体走本地资源、无加载延迟，一次性多 6 MB 换「任何原文不豆腐」值得；粗体靠 `font-weight` 算法加粗即可，不必再带 Bold 字重。
