# R2 调研：作品包容器、身份、版本与更新

2026-11-21。实测环境：Node 24.18.0，yauzl/yazl 最新版，`@earendil-works/pi-schema` 1.6.0。试验产物在 `/tmp/nl-r2/work-package/`。

## 1. 结论

1. **ZIP + yauzl/yazl 完全够用，播放器直接从包里流式读素材没有性能问题**。2 GB、20800 条目的合成包：yauzl `open` 1.5–1.8 ms，枚举整个中央目录 ~0.5 s（一次性、可缓存）；随机读一张 2.5 MB 图片 p50 = 4.4 ms（deflate）/ 2.8 ms（store）；玩家进场一次读「背景+2 立绘+场景 JSON」p50 ≈ 12 ms / 7 ms。对比同数据散文件：图片 p50 = 1 ms，四件套 p50 = 2.2 ms。zip 内读取比散文件慢约 3–5 倍，但绝对值在十毫秒级，远低于一帧预算和任何 IO/解码时间。**结论：不用为播放器解包、不用换格式。**
2. **压缩策略：`webp`/`png` 等媒体一律 STORE，JSON/`.nvs`/`styles.css`/原文一律 DEFLATE**。实测：真实 WebP deflate 反而可能变大（总比率 0.993，有样本 1.069）；中文剧本/样式压缩到 ~5%。legacy `zip-writer.ts` 的 `MEDIA_STORE_EXTENSIONS` + `isStoreEntry` 策略方向正确，搬时把扩展名集换成 `webp`（legacy 写的是 png/woff2/ttf/otf）。
3. **ZIP64 已由 yazl/yauzl 自动处理，不用自己管**。yazl 在 `uncompressedSize > 0xfffffffe` 或 `relativeOffsetOfLocalHeader > 0xfffffffe` 时自动写 ZIP64 结构，也接受 `end({forceZip64Format:true})`；yauzl 完整实现 ZIP64 EOCD 解析，实测读 ZIP64 包正常。4K 作品超 4 GB 不需要换方案。
4. **20k 条目的中央目录 ~1.5 MB（占包 0.08%）**，不是问题；但 yauzl 枚举 20800 条要 ~0.5 s，建议播放器侧把「文件名→entry」表在打开包时建一次 Map 缓存（一次枚举），不要每次 `find`。
5. **身份/版本号参考 Sketch `meta.json` 双字段模型已是最稳妥做法，与现设计兼容**：包内 `work.json` 加 `formatVersion`（格式 schema 版本，枚举式递增，对应 Sketch `version`）与 `minReaderVersion`（可读此包的最低读取端版本，对应 `compatibilityVersion`），另记 `appVersion`。作品自身的 `version`（每导出 +1）语义已定在 `handoff-defaults.md:87`，保留不动；两个版本号用途不同，不要合并。
6. **存档位/已读迁移靠场景+句子 ID 的设计已覆盖**（`work-format.md:157`、`player.md:97`），Ren'Py 的 `_version` + `after_load` 回调、persistent `_update()` 合并思路印证此路可行；缺口在「工程/导入包内 json 的 formatVersion 迁移链」没有写——见 §3 缺口 G3。
7. **连载更新直接整包替换即可，不做 delta**。Godot PCK 分层补丁、Ren'Py RPA 追加包都依赖引擎运行时 overlay；我们的玩家场景只是「导入新版替换旧版」，包体全量替换最简单、存档迁移逻辑不变。要省下载体积时，可选「同 ID 素材去重」（同系列共享素材在新包里照旧放，但导出时按内容哈希跳过与旧包相同的条目）——见 §3 G5，建议不做。
8. **完整性与安全：yauzl 已挡 zip-slip**（拒绝 `..`、绝对路径、盘符、反斜杠），**但不校验 CRC**——STORE 条目读到坏数据不会报错。建议导入端在解出 JSON 前用 `entry.crc32` + `zlib.crc32` 抽验（或者干脆不做校验，`不做防御性设计`也允许）。**真正需要在 `work-format.md` 补的是导出排除清单**：`project.db`（含 API Key 引用？——查过，project.db 不含 Key，Key 在 `userData/config.json`，但含对话记录/用量/运行记录）、`candidates/`、存档（本来就在应用数据目录不进工程）。`work-format.md:145` 写了「不含 project.db 和 candidates/」已覆盖；**缺口是没有写「导入的包防路径越界」和「版本/哈希字段」**，见 §3。
9. **`import` 的"陌生人的包"信任边界**：按决策「不为作品包设计安全模型」只保留两条代码事实就够：yauzl 自带路径校验（`path.ts` 的 normalizePackagePath 仍可搬来当防御底，83 行）；`<script>`/可执行内容天然不存在（包里只有文本/JSON/WebP/CSS，播放器不执行 CSS 以外内容，CSS 不跑 JS）。这两条建议在 `work-format.md` 导出/导入节各写一句，不算防御设计。

## 2. 证据

**容器/随机读取实测**（`/tmp/nl-r2/work-package`，命令见 `build-zip.mjs`、`read-bench.mjs`、`fs-bench.mjs`）：

- 合成包：800×2.5 MB 不可压缩伪 WebP + 2000 个中文 JSON + 18000 填充条目 = 20800 条，未压缩 2.0 GB。
  - deflate 全量：写入 18.3 s，体积 2,004,205,475（反而 +0.2%）。
  - store 全量：写入 6.7 s，体积 2,020,062,452。
- yauzl 打开（EOCD+ZIP64 locator 探测）：**1.5–1.8 ms**；枚举全部 20800 条 entry：**486–542 ms**（一次）。
- 随机读延迟（100 次）：图片 deflate p50 4.4 / p95 8.3 ms；图片 store p50 2.8 / p95 6.9 ms；JSON p50 0.2 ms；「背景+2 立绘+场景 JSON」一次登场 deflate p50 11.8 ms，store p50 6.9 ms。
- 同数据散文件对照：图片 p50 1.0 ms，JSON p50 ~0 ms，四件套 p50 2.2 ms。
- 中央目录大小：1,582,880 B（20800 条，UTF-8 中文路径），占包 0.078%。
- yauzl `openReadStream` 支持 `start`/`end` 字节区间（raw 模式），将来要流式段读可用（`node_modules/yauzl/index.js:527-545`）。
- yauzl 内置 `validateFileName`（`index.js:871-882`）：反斜杠→`/` 后拒 `\\`、绝对路径、`X:` 盘符、任何 `..` 段——**zip-slip 已被库挡住**，实测 python zipfile 造的 `../escape.txt`、`/abs.txt`、`sub/../../up.txt`、`C:\win.txt` 全部抛错。
- **yauzl 读取不校验 CRC32**（grep 全文件只有头部解析和 Unicode extra field 用到 crc32，没有读路径校验）；STORE 条目坏数据静默通过。crc32 在 `entry.crc32` 上有，需要时自己对 `zlib.crc32` 验。
- yazl 写侧 `validateMetadataPath` 拒 `..`（`index.js:413`）；`useZip64Format` 按尺寸/偏移自动升级，`forceZip64Format` 可强制（`index.js` 对应段落，实测 ZIP64 包 yauzl 读正常）。
- 压缩率实测：真实 WebP 4 个样本 deflate 比率 0.981–1.069（无收益、可为负）；中文 JSON 0.03；`.nvs` 0.049；`styles.css` 0.063。

**同类格式对照（一级来源）**：

- **EPUB OCF 3.2/3.3**（W3C，`epub-ocf.html` §3.4/§4）：ZIP、根目录单 `mimetype` 文件必须为**第一条目且不压缩不加 extra field**，内容=媒体类型 ASCII；`META-INF/container.xml` 指入口；文件名白名单（禁 `/:?"<>\\|*`、控制字符、Private Use、超 255 B 文件名/65535 B 路径）；压缩方法只允许 0(STORE)/8(DEFLATE)，只允许必要时的 ZIP64；`version needed` 只能 10/20/45。**Codec（已是压缩格式的媒体）SHOULD NOT 再 deflate，Non-Codec SHOULD deflate** —— 与我们的实测结论一致。
- **ODF 1.4 Part 2**（OASIS）：同 OCF——`mimetype` 第一条目 STORED。
- **Sketch `.sketch`**（developer.sketch.com + sketch-document `meta.schema.yaml`）：ZIP+JSON；`meta.json` 有 `version`（单调枚举 121–146）、`compatibilityVersion`（当前 = 99 常量）、`appVersion`、`created.appVersion`、`saveHistory[]`。文档被新版本 Sketch 保存后，旧版 Sketch 按 `compatibilityVersion` 判断能否打开。
- **H5P `.h5p`**（h5p.org spec）：ZIP + 顶层 `h5p.json`（包定义，`mainLibrary`/`preloadedDependencies`/`language`）+ `content/content.json` + 库目录；身份=库名+版本。
- **Twine**（twinery.org 参考 + twine-specs）：导出为单 HTML 文件，`<tw-storydata format="Harlowe" format-version="3.3.7">` 携带引擎名+引擎版本；跨 format-version 导入是已知痛点（社区多例「老故事导入失败」），教训：**版本字段要早写，且导入端要容忍缺失/未知值**。
- **Ren'Py**（本地 `/tmp/nl-r2/VnRuntime/renpy` + 官方文档）：游戏资源包 `.rpa`（自有格式，RPA-3.0 头+zlib 索引）；存档 `logf.getvalue()` pickle+JSON 头含 `_version`（= `config.version`，作品版本）、`_renpy_version`（引擎版本）；读档走 `log.unfreeze(roots, label="_after_load")` 给脚本回调做迁移；persistent 跨存档/跨版本 `_update()` 按字段合并，未定义字段读 None 不崩。存档迁移=「版本号记下+读档时跑迁移回调+读不到字段给默认」的模式与我们「按场景/句子 ID 迁移」同构。
- **Godot PCK**（docs.godotengine.org）：`load_resource_pack(path, replace_files)` 分层 overlay 支持增量补丁/DLC——参考价值是「分层覆盖」思想，文件粒度替换而非 delta 编码；对我们整包替换的场景不需要。
- **WebGAL**：发布即整个 `game/` 目录+播放器运行时静态拷贝（web 形态或 Electron 打包），没有「作品包文件」这层——无版本概念，不构成本设计参照。
- **`.fig`**（openfig-core `archive.md` 逆向文档）：ZIP（STORE）+ `canvas.fig`（kiwi-schema 二进制）—— ZIP 当容器、单文件入口的模式与 H5P/Sketch 相同。

**pi-schema 1.6.0 实测**（`/tmp/nl-r2/work-package/node_modules/@earendil-works/pi-schema`）：

- `obj()` 默认 `additionalProperties:false`，未知字段 `errors()` 报 `/futureField additionalProperties unknown field`；`obj(props,{open:true})` 放宽为「已知字段校验、未知字段放行」——**前向兼容的现成开关**。
- 全量导出：`compile, obj, opt, arr, str, int, num, bool, lit, oneOf, union, map, tuple, recursive, unknown, unsafe, nullable, nul, bytes, bigint, equal, Validator, CoercingValidator, Optional`。
- `compile(schema).check(value)` / `.errors(value)` 都是同步纯函数，可在导入端先跑「读出 work.json → 按 formatVersion 选 schema → check」。

## 3. 对照现有设计

| # | 发现 | 判定 |
|---|------|------|
| F1 | ZIP + yauzl/yazl 流式按条目读 | **已覆盖** `architecture.md:57`、`decisions.md:328` |
| F2 | 单一语义化格式、加载时编译、可再编辑 | **已覆盖** `decisions.md:66-71`、`work-format.md:7` |
| F3 | 导出排除 `project.db`/`candidates/`、原文可选 | **已覆盖** `work-format.md:145`、`ux.md:80` |
| F4 | 版本号每导出 +1、按 workId 判断、提示后替换、存档按 ID 迁移、对不上的旧存档保留 | **已覆盖** `work-format.md:157`、`player.md:97`、`ux.md:78`、`handoff-defaults.md:87` |
| F5 | 存档放应用数据目录不进包/工程 | **已覆盖** `decisions.md:361-366`、`player.md:77` |
| F6 | 「媒体 STORE / 文本 DEFLATE」策略、ZIP64 自动、mimetype 首条目约定、中央目录建索引缓存、yauzl 已挡路径穿越 | **缺口**——`work-format.md` 的「导出」一节只写打包对象没写包内约定。建议在 `work-format.md` 加「包内约定」小节（约 8 行）：第一条目 `mimetype` STORED 内容 `application/vnd.novelive+zip`；`.webp` STORE、其余 DEFLATE；UTF-8 文件名；读取端按中央目录建一次索引；yauzl 路径校验兜底。 |
| F7 | `formatVersion`/`minReaderVersion`/`appVersion` 字段 | **缺口**——`work.json` 现有字段只写了「作品 ID、版本号、来源作品、作品设置」（`work-format.md:115`），handoff 补了 `workId/version/derivedFrom`（`handoff-defaults.md:87`），但没有**格式 schema 版本**。建议在 `work-format.md` 的 `work.json` 字段列加 `formatVersion: 1`、`minReaderVersion: 1`、`appVersion: "<app 版本>"` 三行；`series.json`/`volume.json`/`chapter.json`/`bible/*.json`/`glossary.json` 共用同一个 `formatVersion`。 |
| F8 | 导入旧 formatVersion 的迁移链（`migrations.ts`：按 `formatVersion` 顺序跑 1→2→3…，每步纯函数对单个 json 文件升 schema；`formatVersion > 本端版本` → 提示需升级应用） | **缺口**——`work-format.md` 只写玩家端「替换旧版存档迁移」，没写「包格式本身升级时，导入端如何把旧包升上来」。放在 `work-format.md`「导入为工程」节 + `player.md` 加载路径一句「加载时先检查 formatVersion」。 |
| F9 | 连载更新 delta / 素材去重 | **冲突后收敛为不做**——`decisions.md:75` 不做防御性设计、`work-format.md:157` 已写「确认后替换旧版」。整包替换简单可靠；同系列多作品共享素材靠「系列级 assets 本来就在包里一份」（`work-format.md:110-128`）天然去重，不需要跨包 dedup。建议：不做。 |
| F10 | 导出包完整性（CRC/哈希清单） | **缺口（建议不做或做最小版）**——yauzl 不校验 CRC（实测+源码证实）。两个选项：(a) 不做：ZIP 链路短、坏包在解 JSON 时会抛解析错，符合「不做防御性设计」；(b) 在导出时顺手写一个 `manifest.json`（路径→crc32+size），导入端只在「读某个 JSON 失败」时拿它定位坏条目并提示——不是加密签名、只是损坏定位，约 30 行。**推荐 (a) 不做**，把「文件损坏」归入普通解析错误处理。 |
| F11 | `import` 的包是信任边界（zip-slip、路径、大小） | **部分覆盖**——yauzl 自带路径校验挡掉 zip-slip（实测），`work-format.md` 无相关文字；大小/条目数上限按决策「不设体积/数量上限」（`decisions.md:75`）就不设。建议在 `work-format.md` 导入节写一句「解包路径校验由 yauzl 兜底，包内不出现绝对路径与 `..`」，不再加代码。 |
| F12 | 玩家端读包不看 mtime/不看文件头检测格式 | **缺口（小事）**——EPUB/ODF/Sketch 都用首条目 `mimetype` 让 `file`/`xdg-mime` 嗅探；我们的文件关联靠 `.novelive` 扩展名+双击（`handoff-defaults.md:81`），多数情况够。`mimetype` 首条目成本一行代码，建议加上（见 F6），让 `file xxx.novelive` 能报对类型。 |
| F13 | `nvs` 文本、JSON、CSS 的具体压缩收益实测 | 已在 F2/F6 落进建议。 |
| F14 | 「场景和句子 ID 稳定 → 存档迁移、已读、修改历史挂靠」 | **已覆盖** `decisions.md:270-275`、`work-format.md:92`，Ren'Py `_seen_ever`/persistent `_update()` 是同构先例。 |

## 4. 可拷资产

| 资产 | 位置 | 许可 | 用途 |
|---|---|---|---|
| `normalizePackagePath`（83 行：NFC、拒 `\0`..`\x1f`/`\x7f`、`\`、绝对路径、盘符、`//`、尾 `/`、空段、`.`/`..`） | `Novelive-legacy/packages/package-kit/src/path.ts` | 自家 MIT→AGPL 项目内 | 导入端二道校验底（yauzl 已挡；此函数还管 NFC 归一和空段，是导出端写路径时的断言，顺手搬） |
| `MEDIA_STORE_EXTENSIONS` + `isStoreEntry` + 确定性 ZIP 写出思路（按路径排序、固定 mtime、Unix mode） | `Novelive-legacy/packages/publisher/src/export/zip-writer.ts` | 同上 | 移植时扩展名集换成 `{webp}`（其它媒体未来再加）；确定性写出的「排序+固定 DOS 时间」让同一工程两次导出字节一致，顺手保留 |
| `ArchiveFingerprint`（size + 中央目录 sha256 + buildId + mtime） | `Novelive-legacy/packages/package-kit/src/fingerprint.ts` | 同上 | 用于「库 → 包」绑定/重定位判定，M5 导入列表用得上；和「作品 ID+版本」语义不同，是物理文件身份 |
| `buildArchiveReader`/`ListedEntry`（含 `isUnixSymlinkEntry` 检测） | `Novelive-legacy/packages/package-kit/src/archive-reader.ts` | 同上 | 若不做解压到磁盘、只用 yauzl 顺序读，可不搬；若要解包落盘才需要 symlink 检测——按现设计（player 直接从包流式读）不搬 |
| `SecurityLimits` 接口形状 | `Novelive-legacy/packages/package-kit/src/security-limits.ts` | 同上 | 不搬：决策已定不设上限；接口形状可留作「以后真要设限时」的参照 |
| pi-schema `obj(...,{open:true})` | npm 包，已在依赖 | MIT | 版本迁移时读旧包用 open schema |
| Ren'Py `persistent._update()` 模式（读档后逐字段给默认、回调迁移） | `renpy/persistent.py` | MIT | 只参考思想：读档迁移回调 + 字段级默认，落实到我们「按 ID 迁移+对不上保留」 |

## 5. 需要所有者取舍的事

1. **要不要 `formatVersion`/`minReaderVersion`/`appVersion` 三个字段进 `work.json`（及所有 json 头）**
   - 选项 a（推荐）：加。成本=导出时写三行+导入时一次比较；价值=「作品格式升级」时能区分「旧版包可迁移」vs「新版包我不认识」，不会把未知 schema 硬解析。Sketch/EPUB/H5P 全都这么做。
   - 选项 b：不加，格式变更时直接改 schema、导入失败让用户升级应用。符合「不做防御性设计」字面，但第一次格式演进就要补课。
   - 建议 a——这不是防御性设计，是格式自描述的最小字段。
2. **导入端是否做 CRC/清单校验**
   - 选项 a（推荐）：不做。坏包在 JSON.parse/schema 校验时自然报错；ZIP CRC 32 位弱校验挡不住有意篡改，真校验要签名——超出第一版范围。
   - 选项 b：导出时写 `manifest.json`（每条目 crc32+size），导入失败时定位坏条目。30 行，给用户更有用的报错。
   - 建议 a；如果 M5 实测「坏包报错难懂」再补 b。
3. **连载更新要不要 delta/素材去重**
   - 选项 a（推荐）：整包替换。作者导出新版，玩家确认后整个换掉；简单、无状态。
   - 选项 b：导出时读旧包，相同（按 crc）的素材条目跳过，新版本只带增量+旧包指针。省流量但导入逻辑复杂，还得处理「玩家没装旧版」。
   - 建议 a。
4. **`mimetype` 首条目 STORED**
   - 选项 a（推荐）：加，内容 `application/vnd.novelive+zip`。一行代码，让 `file`、解压工具、第三方查看器认出类型；EPUB/ODF 惯例。
   - 选项 b：不加，只靠扩展名。
   - 建议 a。
5. **中央目录 → 文件名索引**由播放器侧打开包时枚举一次建 Map（~0.5 s/2 万条，一次成本），还是每次按名查找（yauzl 线性扫中央目录）。建议前者（一次枚举缓存）——这只是实现注意点，不进文档也行，但 `architecture.md` 提一句更好。
