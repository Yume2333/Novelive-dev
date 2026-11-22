# 作品格式与工程

说明 Novelive 的单一作品包格式、剧本语言、内容层级、本地工程组织以及导出、导入与版本更新规则。

## 单一格式与编译

Novelive 只有一种格式。作品包中保存语义化剧本、设定集、术语表和分层素材，[播放器](./player.md)在加载时现场编译。

- **剧本**用文本剧本语言写：写手一次输出一整章，内部用 `scene` 块分场；应用按块拆开，一个场景存一个 `.nvs` 文件。
- **设定集、术语表、作品信息**等结构化数据用 JSON，格式由 pi-schema 定义（字段见[设定集与术语表](./bible.md)）。
- 剧本解析后的结构也由 pi-schema 定义，播放器、编辑器和编译器都用这份结构。

## 内容层级

支持长篇（数百上千章），内容保留四级层级：**系列 → 卷 → 作品 → 章节**。章节由若干场景组成，场景是 Agent 重写的单位。

一个工程对应一个系列；单部作品就是只有一卷、一部作品的系列。

## 剧本语言

### 场景文件

```text
scene 教室的黄昏
source p0012-p0018

@bg classroom/dusk fade 1.5
@show lin-xiao/uniform/angry left
lin-xiao: {whisper}其实……{/whisper}{wait 0.6}我一直在等你。 #a3f9
lin-xiao (inner): 为什么偏偏是今天。 #b81c
: 窗外的蝉声停了。 #c02d
@caption 七月十四日 傍晚 #e5a1
@shake strong 0.4
lin-xiao as 神秘少女: 你终于来了。 #d77e
```

- **场景头**：`scene` 后写场景标题，`source` 写这个场景对应的原文段落范围，两行都由模型写，用于原文对照和双向跳转；应用只核对 `source` 指向本章里存在的段落。
- **段落编号**：`source` 引用的 `pNNNN` 由导入器分配，章内从 1 起、四位零填充（编号 10000–99999 用五位），写进 `chapter.json`；各场景的 `source` 区间按序、闭区间，合起来恰好覆盖本章每段一次。`source p0001` 是 `source p0001-p0001` 的简写。重新导入时如需收回越界范围，由导入流程修正；编译器不会静默改写范围。
- **指令词和名字用英文**：指令词（`@bg`、`@show`、`inner`）和角色、地点、素材名都用英文，剧本语言和作品语言分开；显示名写在设定集里。

### 文字

| 写法 | 文本类型 |
| --- | --- |
| `lin-xiao: …` | 对白 |
| `lin-xiao (inner): …` | 内心独白 |
| `: …` | 旁白 |
| `@caption …` | 字幕 |

`lin-xiao as 神秘少女: …` 给这一句单独指定显示名，内部仍认作 `lin-xiao`。文本类型的含义见[播放器](./player.md)。

句子长度不设硬上限，剧本检查不因为长度退回写手。写手按改编强度的目标句长写（见[创作流水线](./creation-pipeline.md)）；一句话在 1280×720、默认样式下预计装不进一个对话框时（中日韩字符按 1 计、半角字符按 0.5 计，超过约 90），剧本检查给警告 `W_LINE_LONG`，只提醒不退回。装不下的句子由播放器分页显示（见[播放器](./player.md)）。

### 行内标签

一句话中的文本标记、注音、停顿和变速写成行内标签：

```text
{whisper}其实……{/whisper}{wait 0.6}我{speed 0.5}一直{/speed}在{ruby ま}等{/ruby}你。
```

- **内置标记**：`em` 强调、`b` 加粗、`dim` 弱化、`whisper` 小声、`shout` 大喊、`glitch` 扭曲、`hl` 高亮。
- **自定义标记**：作品自己命名（英文），样式见下文“自定义样式”。
- **注音**：`{ruby 读音}字{/ruby}`。
- **停顿**：`{wait 秒数}`，非负，为单标签。
- **变速**：`{speed 倍率}…{/speed}`，倍率大于零。
- 字面的 `{` 写成 `{{`。

除 `wait` 外，标签都要在同一句中按嵌套顺序闭合。`ruby` 的读音允许空格；自定义标记必须在作品设置中登记。

### 演出指令

演出指令以 `@` 开头，写意图：只写“谁、做什么、在哪”，坐标、时长、缓动等由编译器给默认值；需要时可以在后面写参数覆盖（如上例的 `fade 1.5`、`strong 0.4`）。以后做时间线编辑器时直接改这些参数。剧本里不写逐条的行内演出指令；一句话说到一半要发生的演出拆成两句写。

指令全集。保存时必填项按表中顺序写，可选项写成空格分隔的 `key value`（例如 `@bg classroom/dusk transition fade duration 1.5`）。解析时带名可选项可在必填项前后出现，也接受表中顺序的无名参数。`@zoom` 的旧写法按类型归一，第一个数字是倍率。

`@hide` 中的角色 ID 可以和可选参数同名。当前词既可作必填 ID 又可作参数名时，仅当后面的值合法且剩余词数足够填写必填项，才将它读为参数名；例如 `@hide duration duration 1` 隐去角色 `duration`。

| 指令 | 必填参数 | 可选参数和默认值 | 生效类型 |
| --- | --- | --- | --- |
| `@bg` | `<place/variant>` | `transition fade`（同地点变体默认 `none`），`duration 0.4` | 设置型 |
| `@fg` | `<素材 ID>` 或 `none`（清除） | — | 设置型 |
| `@show` | `<char/costume/expr> <slot>` | `transition none duration 0.2` | 设置型 |
| `@hide` | `<slot>` 或 `<角色 ID>`（隐去该角色所在槽位） | `transition none duration 0.2` | 设置型 |
| `@move` | `<slot> <target>`（只改变位置，不改变槽位身份） | `easing ease-in-out duration 0.3` | 设置型 |
| `@face` | `<char/costume/expr>` 或 `<char/expr>`（按在场角色的当前造型查表） | `duration 0.2` | 设置型 |
| `@costume` | `<char/costume>` | `duration 0.2` | 设置型 |
| `@cg` | `<cg-id>` 或 `none`（清除） | — | 设置型 |
| `@camera` | `sway\|push-in\|pull-out\|reset` | `easing ease-in-out duration 0.5` | 设置型 |
| `@zoom` | `<倍率>`（大于零） | `target center duration 0.4 easing ease-out`；目标还可用 `stage`、`left`、`right` | 设置型 |
| `@shake` | — | `strength 0.35 duration 0.3 easing ease-out`；强度 0–1，`strong` 为 1 | 设置型 |
| `@particle` | `rain\|snow\|sakura\|none`（停止） | `intensity 0.5 speed 1 angle 0`；强度 0–1，速度非负，角度 −360–360 度 | 设置型 |
| `@mask` | `vignette\|letterbox\|none`（清除） | `strength 0.5`，范围 0–1 | 设置型 |
| `@filter` | `blur\|brightness\|sepia\|glitch\|none`（清除） | `value 0.5`，非负 | 设置型 |
| `@caption` | `<text...>` | 行尾 `wait`、`#id` | 文本型 |
| `@wait` | — | 裸写等点击，`@wait N` 停 N 秒自动往下走；行尾可加 `#id` | 文本型 |

已定的参数词表：

- **转场**（`@bg`、立绘进出场等）：`fade`（经黑场）、`dissolve`（交叉淡化）、`wipe-left`/`wipe-right`/`wipe-up`/`wipe-down`、`slide`、`push`、`iris`、`zoom`、`none`。
- **缓动**（`@move`、镜头、`@shake` 等）：`linear` / `ease` / `ease-in` / `ease-out` / `ease-in-out`。
- **数值**：有限十进制数，不用科学计数法；时长和停顿以秒计且非负。
- **粒子**：首批内置 `rain`、`snow`、`sakura`，参数只有强度、速度、风向角度；模型写意图名和强度，不写粒子物理参数。
- **画面滤镜**：首批 `blur`、`brightness`、`sepia`、`glitch`。
- **槽位规则**：立绘按位置槽管理，槽位枚举 `left` / `center` / `right`，身份是“素材名 + 槽位”。`@show` 在同一槽位换表情或造型且素材身份不变时，保留该立绘已有的位置、变换和层级。

### 推进节奏

- 每一句对白、内心独白、旁白等一次点击。
- 写在一句话前面的指令和这句话同时生效。
- 只有演出、没有文字的段落（比如单独展示一张 CG）用裸 `@wait` 显式等点击；不写就直接接下一句。
- 字幕默认不等点击，加 `wait` 才等；字幕也是句子，带句子 ID。
- 对白、独白、旁白行尾写 `cont`（在句子 ID 前）表示这句播完不停顿、直接接下一句，用于抢话、半句切演出这类衔接。

编译产生按顺序播放的节拍：设置型指令合入随后第一条文本型指令，场景末尾仅有设置型指令时产出自动推进的节拍。字幕、`cont` 和定时等待按各自规则推进，不隐式等待点击。整章内跨场景保留舞台状态以解析省略的造型。

### 解析与模型输出

模型直接输出剧本文本（一次一整章，内部用 `scene` 块分场），应用做剧本检查与局部修复：解析器给出带错误码和位置的诊断，代码先修代码块围栏、BOM、换行这类机械问题，再查素材名、原文段落范围、句子 ID；只把出错的场景退回写手改，不整章重写，同一场景连续 3 次退回仍不过时整章标“需要处理”。素材名未登记、`source` 段落范围越界、句子 ID 重复都退回写手，不自动改。写错的行内标签也在这一步报出。

解析接受开头 BOM、CRLF，以及一对外围 Markdown 反引号围栏（无语言或 `nvs`、`text`、`txt`）；保存为无围栏 LF 文本。诊断为 `{code, line, col, message, hint}`，行与列从 1 开始，按原输入定位（列以 UTF-16 码元计，开头 BOM 不计）。

| 诊断码 | 含义 |
| --- | --- |
| `E_FENCE` | 围栏没有成对或位于正文 |
| `E_SCENE` / `E_SOURCE` | 场景头缺失，或原文范围行格式错误 |
| `E_SOURCE_RANGE` / `E_SOURCE_COVERAGE` | 段落不存在、顺序颠倒，或未按序覆盖整章 |
| `E_LINE` / `E_COMMAND` / `E_ARGUMENT` | 无效剧本行、指令名或参数 |
| `E_ID` / `E_DUPLICATE_ID` / `E_ID_EXHAUSTED` | ID 格式错误、重复或没有可分配的 ID |
| `E_TAG` | 未登记或不配对的标签，或参数不合法 |
| `E_SPEAKER` / `E_ASSET` / `E_STAGE` | 说话人不在设定集、素材未登记/歧义/种类不符，或指令引用未上场的立绘 |
| `W_LINE_LONG` | 文字可能超过一页；不阻止编译 |

素材引用用登记表校验，登记过的未绘制项也合法。别名映射到登记表的正式 ID；歧义别名报错。编译结果包含默认参数和正式素材 ID，保存文本仍保留显式参数和原素材名。

## ID 与命名

- **场景和句子**：由应用自动分配随机短 ID，模型不写 ID。场景 ID 为 8 位小写十六进制，是文件名；句子 ID 为 4 位小写十六进制（`[0-9a-f]{4}`），场景内冲突重摇，写在行尾（如 `#a3f9`），每一句文字和每个 `@wait` 都带。模型输出的新行在保存时补上 ID（追加在行尾最末，`cont` 写在 ID 前）；模型改写已有的行时保留原 ID。内容改了 ID 也不变，存档、已读、修改历史都靠它对接。编辑器里移动一行算删掉再新增：剪切让原 ID 消亡，粘贴出来的行补发新 ID。
- **素材 ID**：角色、造型、表情、地点、变体、CG 用可读英文名，创建后不改。ID 形状：地点 `place/variant`、角色 `character/costume/expression`、CG `cg-<id>`；全部登记在素材登记表里（见“目录结构”），写手、美术导演、画师、编译器、播放器都只认这一张表的 ID。剧本里的素材引用（`lin-xiao/uniform/angry`、`classroom/dusk`）查登记表，说话人 ID（`lin-xiao:` 的 `lin-xiao`）查设定集角色表，两者分开校验；同义表情合并登记的别名也走这张表解析。

重存时优先传入场景文件名中的 ID；模型整章输出没有场景 ID 时用同位置、同标题的上次场景匹配。无显式句子 ID 的行用场景内非空内容行位置及其前缀匹配（文本类型、角色及显示名，或 `@wait`），未匹配的行分配新 ID。

## 自定义样式

作品的自定义样式直接写 CSS，可以带动画关键帧，不加限制，存在 `styles.css` 中，跟着系列、卷、作品的层级走。

- **自定义标记**：每个标记有一个“逐字”开关，打开后每个字单独套样式，用来做波浪、跳字这类逐字动画。
- **游戏界面**：播放器内置两种对话框样式（柔边通栏、浅色纸笺），作品可以选一种做底子，再用 CSS 改对话框、名字牌和快捷按钮的样式。

作品可以用自己的字体：`assets/fonts/` 下放 woff2 文件，`styles.css` 里 `@font-face` 引用；导出时按原文和剧本文本用到的字符并集自动裁成子集随包分发（subset-font，纯 wasm，在创作端跑）。

## 目录结构

```text
<工程>/
  project.db                 任务状态、用量记录、对话记录（会话条目树）、提议（确认卡）、修改历史、运行记录（SQLite）
  source/                    原文与导入产物：
                             original.<ext> 原始文件、chapters/<章节 ID>.txt 分段纯文本、
                             chapters/<章节 ID>.notes.txt 章附注（导入时剔除的注释、脚注、版权页等非正文段）、
                             preview/ 全书预览结果、images/ EPUB 插图（EPUB 在 M4）、导入报告文件（M1a 写入核对与分卷建议，供向导读取）
  candidates/                候选图
  series.json                系列信息
  bible/  glossary.json  styles.css  assets/        系列级共享（assets 内含素材登记表 asset-registry.json，见下）
  volumes/<卷 ID>/
    volume.json
    bible/  glossary.json  styles.css  assets/      卷级覆盖（可选）
    works/<作品 ID>/
      work.json              作品 ID、版本号、来源作品、作品设置
      bible/  glossary.json  styles.css  assets/    作品级覆盖（可选）
      chapters/<章节 ID>/
        chapter.json         章节标题、场景顺序、本章 CG 描述、段落编号表（pNNNN）
        <场景 ID>.nvs        场景剧本
```

素材目录：

```text
assets/
  asset-registry.json        素材登记表
  style/                     画风参考图：main-visual.webp（主视觉）及最多 2 张补充参考（路径与风格描述记于 bible/style.json）
  fonts/                     作品自定义字体（woff2）
  characters/<角色>/<造型>/<表情>.webp
  locations/<地点>/<变体>.webp
  cg/<CG>.webp
```

`assets/asset-registry.json` 是素材登记表，系列内逐级共享、按 ID 整条覆盖（同“系列共享与覆盖”）：地点 `place/variant`、角色 `character/costume/expression`、CG `cg-<id>` 每条登记成一行，含 ID、类型、文件路径、状态（已画 / 待画 / 占位）；同义表情合并登记的别名（[视觉管线](./visuals.md) §2.1）也写在这张表里，按别名查到同一素材。说话人 ID 不在这张表，查设定集角色表。字段说明见[设定集与术语表](./bible.md)。

图片默认存为有损 WebP（质量 90，保留透明通道），应用设置里的全局开关可改无损；由创作端在出图后转换（见[视觉管线](./visuals.md)）。

`work.json` 字段：`workId`（UUID 不可变）、`version`（每次导出 +1）、`derivedFrom`（来源 workId+version，可选）、`minReaderVersion`、`appVersion`、作品设置。

`work.json` 里的作品设置包含：改编强度、演出密度、改编要求、规则（本作品和各章）、写手预设选用、审稿（忠实度检查默认开，文风审稿默认关）、已有参考图时是否停在确认点 1、自定义标记、输出分辨率（2K / 4K）、作品主色（播放器皮肤用，DESIGN.md 里的 `Work.accent`，从主视觉取色，创作者可改）。

## 工程文件夹

工程是一个本地文件夹，里面包含解包后的作品，以及创作专用数据（原文、任务记录、候选图、对话记录、提议、修改历史、运行记录、用量记录）。作品内容是普通文件；任务状态、用量记录、对话记录（会话条目树）、提议（确认卡）、修改历史和运行记录存在 `project.db` 中。

新建作品时自行选择工程位置，默认在 `文档/Novelive` 下；整个文件夹拷走就能换机器。

## 导出与导入

### 导出

导出功能将工程中可以分享的部分打包为 `.novelive` 文件（ZIP），目录结构与工程相同，不含 `project.db` 和 `candidates/`。分享只靠文件，不记录、不展示版权或署名信息。

- **导出范围**：可选单部作品、整卷或整个系列；导出单部作品或整卷时，带上它继承的上级共享内容。
- **原文选项**：导出时可选是否带上 `source/`，默认不带。
- **需要处理章节提醒**：图片最终失败的章节标为“需要处理”（见[创作流水线](./creation-pipeline.md)），导出时会列出这些章节提醒创作者，但不阻止导出。

### 包内约定

- 第一条目是 `mimetype`，不压缩（STORED），内容为 `application/vnd.novelive+zip`。
- `.webp` 条目不压缩（STORE），JSON、`.nvs`、`styles.css` 等文本条目用 DEFLATE。
- 条目名一律 UTF-8。
- 读取端打开包时按中央目录建一次「文件名 → 条目」索引缓存（2 万条约 0.5 秒，一次性内存结构）；包损坏在打开时报“文件损坏或不是 Novelive 作品包”。
- 解包路径校验由 yauzl 兜底：拒绝 `..`、绝对路径、盘符和反斜杠，包内本来就没有这些。
- 不写逐条目哈希清单：坏包会在 JSON 解析或 schema 校验时报错，按普通解析错误处理。

### 格式版本与迁移

- 每个 JSON 文件（`series.json`、`volume.json`、`work.json`、`chapter.json`、`bible/`、`glossary.json`）头部都带同一个 `formatVersion`（当前 1）；`work.json` 另记 `minReaderVersion`（可读此包的最低读取端版本）和 `appVersion`（导出它的应用版本）。
- 导入旧 `formatVersion` 的包时，导入端按版本顺序跑迁移链（1→2→3…），每步是纯函数、一次只升级一个 JSON 文件。
- `formatVersion` 高于本端版本时提示升级应用，不硬解析；`minReaderVersion` 高于本端时拒绝导入并提示升级；同一 `formatVersion` 下 schema 校验失败按普通解析错误提示文件损坏。
- 读旧包用 pi-schema `obj(..., {open:true})`：已知字段校验，未知字段放行。
- 连载中的作品更新走整包替换，不做增量包。

### 导入为工程

`.novelive` 作品包可以导入为新工程继续编辑；再导出就是一部新作品，有新的作品 ID，`work.json` 里记录它来自哪部作品。

`.novelive` 包本身不带可执行内容（只有文本、JSON、WebP、CSS），导入时解出的路径按上面“包内约定”的校验走。

## 版本更新与存档迁移

每部作品有一个固定 ID，每次导出版本号自动加一。玩家端按作品 ID 判断是不是同一作品的新版本：导入新版本时先提示，确认后替换旧版，存档和已读记录按场景和句子 ID 迁移，对不上的旧存档保留（游玩端行为见[播放器](./player.md)）。

## 系列共享与覆盖

同一系列的作品共享系列级的设定集、术语表、标记样式和素材。下级的卷或作品有同 ID 的条目时，整条替换上级的；没有的就沿用上级。

## 相关文档

- [Novelive 产品概述](./product.md)
- [设定集与术语表](./bible.md)
- [视觉管线](./visuals.md)
- [创作流水线](./creation-pipeline.md)
- [播放器](./player.md)
- [界面与流程](./ux.md)
- [系统架构](./architecture.md)
