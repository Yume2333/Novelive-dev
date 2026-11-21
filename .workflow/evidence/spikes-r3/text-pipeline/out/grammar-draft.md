# 剧本指令全集和语法表（M1a 草案，R3 实验验证版）

依据：`docs/work-format.md`、`docs/player.md`、`handoff-defaults.md` M1a 条目，加上本书（骆驼祥子 ch01/02/23）实测中模型实际用到的指令与参数写法。`*` = 实测中被模型产出过；`(?)` = 语法歧义点，见报告 §3。

## 1. 行级语法

| 行型 | 语法 | 说明 |
| --- | --- | --- |
| 场景头 | `scene <标题>`（作品语言） | 场景文件第一非空行 |
| 来源 | `source pNNNN[-pNNNN]` | 段落区间闭区间、按序、整章恰好覆盖一次 |
| 对白 | `<asset-id>: <text> [#xxxx] [cont]` | 说话人用素材英文名 |
| 独白 | `<asset-id> (inner): <text>` | `(inner)` 是括号修饰词，可扩展 `(?)` |
| 显示名 | `<asset-id> as <显示名>: <text>` | as 与 `(inner)` 的组合顺序文档未定 `(?)` |
| 旁白 | `: <text>` | 无说话人 |
| 指令 | `@<cmd> [arg ...]` | key=value 或裸词空格分隔，意图优先 |
| 句子 ID | 行尾 `#xxxx`（4 位小写 hex），保存时补 | 模型不写 |
| cont | 行尾 `cont`，在 `#id` 前 | 播完不停顿直接接下句 |

## 2. 行内标签

`{em} {b} {dim} {whisper} {shout} {glitch} {hl}`、`{ruby <读法>}…{/ruby}`、`{wait <秒>}`（原子，无闭合）、`{speed <倍率>}…{/speed}`、`{{` 转义字面 `{`、自定义标记（英文，需注册）。

实测坑：`{wait}` 是唯一原子标签，解析器按"不需要闭合"特判；模型一次把 `{shout}…` 开了没关（E_TAG_UNCLOSED），机械修复即可。

## 3. 演出指令表

kind: setting=随行生效不等点击 / text-ish=文本型等点击。

| 指令 | 参数 | kind | 状态 |
| --- | --- | --- | --- |
| `@bg` | `<loc[/variant]> [transition] [秒]` | setting | * |
| `@fg` | `<asset>` | setting | 文档有，模型未用 |
| `@show` | `<char/costume/expr> <slot>` | setting | * |
| `@hide` | `<slot>` | setting | * |
| `@move` | `<slot> <target> [easing] [秒]` | setting | 文档有 |
| `@face` | `<char/costume/expr>`（同槽位换表情，不带槽位） | setting | * |
| `@costume` | `<char/costume>` | setting | 文档有，模型未用 |
| `@cg` | `<cg-id>` | setting | * |
| `@camera` | `<动作> [easing] [秒]` —— 实测产出 `sway` `push-in` | setting | `(?)` 参数集文档只写"对焦/缩放"，无词表 |
| `@zoom` | `[target] <倍率> [时长] [easing]` —— 实测两种词序都出现：`center 1.08 1.0 ease-out` 与 `1.1 ease-out 0.4` | setting | `(?)` 必须定词序 |
| `@shake` | `[strong\|0-1] [秒]` | setting | * |
| `@particle` | `rain\|snow\|sakura\|none [强度] [速度] [角度]` | setting | * (`none`=停，实测产出 `@particle rain 0` 表停) |
| `@mask` | 未定 | setting | 文档有，无参数定义，模型未用 |
| `@filter` | `blur\|brightness\|sepia\|glitch\|none [值]` | setting | * (`none` 清除滤镜，模型自发产出) |
| `@caption` | `<text...> [wait]` | text-ish | * |
| `@wait` | `[秒]` | text-ish | * |

槽位：`left center right`（实测够用），`far-left far-right` 备用。过渡：`fade dissolve wipe-left/right/up/down slide push iris zoom none`。缓动：`linear ease ease-in ease-out ease-in-out`。

## 4. 实测暴露的语法缺口（需 M1a 定）

1. `@camera`/`@zoom` 参数词表和词序未定 → 模型两次产出不同词序。建议定死：`@camera <focus目标|shake> …`、`@zoom <倍率> [秒] [easing] [target]`。
2. `@filter`/`@particle` 需要 `none` 清除值（模型自发产出）；`@particle` 实测出现 `rain 0` 表停——建议统一 `none`。
3. `as 显示名` 与 `(inner)` 能否组合、顺序（`as` 在括号前后）文档未写。
4. `scene`/`source` 之后是否允许再出现第二个 `scene`（一场一文件 vs 一章一文件）：docs 两处说法要统一——work-format 说"一个场景一个文件"，写手输出是一章一段带多 scene 头；本实验按"一章一文件、内部分场"跑通且覆盖检查依赖它，建议文档明确：模型输出=一章文本含多个 `scene` 块，应用落盘时按 scene 拆成 `<场景ID>.nvs`。
5. `(inner)` 括号修饰词表开放（模型只产出 inner）；建议定词表 `{inner}` 封闭。
6. `source` 能否写不连续区间（`p0005,p0009`）或空（纯过场）：实测未出现，建议禁止——过场场记挂最近段落。
7. 文本行行尾元素顺序：`[text] [cont] [#id]`；`cont` 在 id 前（保存时 id 追加在最尾）。模型输出裸 `cont` 无 id，解析器须接受两种。
8. 美术导演补丁格式：文档定 `PUT <N:`/`PUT >N:`/`PUT N.=M:`/`CUT N`，但分批模式下模型大量产出 `before 56:`、`132+`、`keep 75:`、`L4 replace:` 等方言——补丁解析器需要宽容规范化层（本实验写了 normalize_patch_text 覆盖 8 种方言），或者整章模式（模型守格式率高得多，9 个场景 0 错）。
