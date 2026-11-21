# R3 文本流水线实测报告

工作目录 `.workflow/evidence/spikes-r3/text-pipeline/`（src=代码、prompts=提示词、work=中间产物+usage.jsonl、out=交付物）。用书《骆驼祥子》24 章 138k 字。模型：eval completion（smol=预览、default=其余）、judge。token 估算：`CJK字符×k+非CJK字节÷4`，eval 模型按 anthropic k=1.0，外推按各 provider k 系数缩放。

## 1. 结论（按重要性）

1. **文档描述的流水线整体能跑通，且关键验收可以纯代码把关**：三章（ch01/02/23）剧本全部通过机械解析、source 段落「恰一次覆盖」、忠实度检查引文核验 9/9 真、修复只退回问题场。覆盖不是模型自觉出来的——必须在写手提示词里把「p0001..pNNNN 每段恰一次」写成显式验收句，再由代码 `coverage_report` 收口（src/nvs.py）。
2. **美术导演 open question 有答案：默认整章读**。整章模式 9 个场景补丁零格式错误、manifest 干净；分批模式（9 批）input 贵 4.1 倍（23,879 vs 5,821 tok）、补丁方言失控（`before N:`、`N+`、`keep N:`、`L4 replace:` 等 8 种非规范写法）、资产名漂移（`xiangzi/plain` vs `xiangzi/ragged-white-jacket/plain` 并存）。分批召回确实更高（24 项 vs 16 项，多出 stray-dog、旗手造型等），但只有超上下文时才值得付这个代价，且必须配规范化层。
3. **指令全集表已起草**（`out/grammar-draft.md`），实测暴露 4 个文档语法缺口：`@camera`/`@zoom` 参数词序未定（模型两种词序都产出）、`@filter`/`@particle` 需要 `none` 清除值（模型自发产出）、`(inner)` 与 `as 显示名` 组合顺序未定、「一章一输出含多 scene 块」与「一个场景一个文件」的表述要统一。
4. **忠实度检查的「引文必须由代码核对」机制设计正确**：9 条 issue 的 quote 全部逐字落在声称的 sourceRef 段落里，无一造假；7/9 是 missing 类，集中出现在暗章（ch23）长段叙述被摘编丢节拍——这是忠实度档真正该抓的，抓到了。
5. **降敏规则对文本侧可行**：ch23 含白房子嫖院、小福子上吊、祥子堕落；带降敏指令重写一次后，自杀以「寻了短见」「人在树林里寻了短见啦」等含蓄措辞保留情节信息，0 诊断 46/46 覆盖。测试环境无真实拒答，「被拒→降敏重写→还被拒→标需要处理」的链路未走到第二步 [推断：同机制]。
6. **文风审稿（默认关）抓到一个真问题**：写手把第三人称叙述思想（「他相信自己有那个资格」）标成 `(inner)`，审稿正确指出声口断裂。文档转换表「他想→inner」缺一条：第三人称自由间接引语的 inner 化要同时改第一人称声口，否则归旁白。
7. **全书 token 外推（eval 口径 ~1.065M，输入 82 万/输出 25 万）**：按 provider 系数 deepseek 73 万、qwen 81 万、glm 78 万、openai(o200k) 97 万、cl100k 144 万。逐章预览占总输入的 ~17%，单章生产（写+审+修+演）约 3.5 万 tok/章。
8. **综合阶段产物质量可交付但有两处要修**：(a) glossary 的 `work` 字段被模型误填成书名《骆驼祥子》66/66 条——提示词的「作品里的写法」被误读，已改为 original 回填；(b) 伏笔抽取贴上限（42 条 ≈1.75/章），混入大量 narratorial 预示而非真伏笔，预览/综合口径要收紧。
9. **修复循环设计正确**：5 次修复调用（4 个场景）全部一次修好且不破坏覆盖，平均 ~2.4k/0.9k tok——「只退回出错场景」比整章重写便宜一个数量级。
10. **分卷建议合理且可机检**：4 卷（1-5/6-12/13-20/21-24）与「三起三落+沉沦」情节弧吻合， contiguous+全覆盖可断言。

## 2. 实测（方法、数据、命令）

### 流水线复现

```
src/common.py   # TXT 规范化（BOM/CRLF/NFC/空行分段）、pNNNN 分配、k 系数 token 估算、ledger
src/nvs.py      # .nvs 机械解析器 + coverage_report + parse_inline 标签校验
work/source/chNN.txt      # [pNNNN] 标注的章原文（模型输入）
work/source/chNN.raw.txt  # 纯文本
work/usage.jsonl          # 52 条调用记录（stage/chapter/role/in_tok/out_tok）
```

各阶段全部按 docs 定义跑：整理（smol）逐章预览 24 章（并发 8）→ 整理分卷建议 → 主控（default）按卷综合 → 写手（default）写 ch01/02/23 → 审稿忠实度档 → 问题场退回写手修复 → 美术导演演出+图清单。

### 逐章预览

24 次调用，in 137,699 / out 24,500 tok，46.9s 并发完成。每章产出 `summary/characters/locations/timelineNotes/foreshadowingHints`，质量足够支撑综合（综合产物里人名、地名、伏笔都对得上原文）。

### 分卷 + 综合

分卷（1 次调用）：4 卷方案 contiguous 全覆盖。综合（4 次调用）：in 27,207 / out 34,847。合并后 52 角色 / 42 地点 / 66 术语 / 47 时间线 / 42 伏笔。跨卷同 ID 条目（xiangzi 等 9 个）由代码合并 knows/changes/aliases——模型不会自我去重，docs 本来就把合并放在代码侧，验证可行。

### 生产三章

| 阶段 | ch01 in/out | ch02 in/out | ch23 in/out |
| --- | --- | --- | --- |
| 写 | 7,081/5,332 | 5,983/4,708 | 6,627/4,406 |
| 忠实度 | 11,637/376 | 9,917/318 | 10,257/1,205 |
| 修复 | 2,972/1,022 | 2,564/1,005 | 7,610/2,435（3 场） |
| 美术导演(整章) | 6,220/797 | 5,564/991 | 5,680/873 |
| 章合计 | 27,910/7,527 | 24,028/7,022 | 30,174/8,919 |

ch23（暗章，46 段）忠实度报 7 条 missing——祥子堕落的机制链条（借钱不还→骗钱花→混日子）被摘编，major 1 条已修复。文风审稿（ch01 试开）：~5.5k/~500，报 2 major（第三人称 inner）+ minor。

### 美术导演整章 vs 分批（ch23，9 场景）

| | 整章 | 分批×9 |
| --- | --- | --- |
| token in/out | 5,680/873 | 23,879/2,275 |
| 补丁格式合规 | 全部 `PUT <N:` 规范 | 8 种方言混出 |
| manifest | 16 项、无重复基座 | 24 项、有命名漂移 |
| judge(bg 覆盖) | 0.23 | 0.52 |
| judge(density rich) | 0.92 | 0.83 |

分批带「前后各一场+累积 manifest」仍挡不住：批 0 把 `@show` 行当上下文要「replace」、批 7 行号格式全错（`132 @bg`）、批 8 交了空补丁。整章版唯一弱项是 bg 覆盖判断分低（judge 对「每个换场点都有 @bg」严格度不同）。

### 覆盖「恰一次」的机制

文档本身没写怎么保证覆盖，只说「写手自己分场，每场写 source 段」。实测机制 = 提示词显式验收句（`prompts/writer-v1.md` 末尾：`Cover every paragraph p0001..{MAXPID} exactly once via source lines, in order`）+ 代码 `coverage_report` 检查 missing/multi 两表。三章一次通过；若出现 gap/overlap，把「缺 p0007-p0011 未覆盖」作为诊断退回写手（与剧本检查同一通道），不用整章重写。

### 失败模式

1. `{shout}` 未闭合 1 处（ch02）→ 机械修复。
2. 暗章 missing 类忠实度问题 7 条 → 修复 3 场解决。
3. 分批补丁方言 8 种 → 写了 `normalize_patch_text` 兼容层才能应用；根本解法是整章模式或强示例。
4. `@zoom`/`@camera` 词序漂移、`@filter none`、`@particle rain 0` 自创写法。
5. glossary `work` 字段误填书名（66/66）→ 字段名歧义，建议 schema 改 `workSpelling` 或提示词补一句「同语言制作时 = 原文写法」。
6. 综合伏笔过收（见 §3）。
7. 跨卷条目合并依赖代码——正常，但验证了「模型提条目、代码合并」分工可行。

## 3. 与现有文档/决策的冲突或缺口

| 位置 | 文档说法 | 实测 | 建议措辞 |
| --- | --- | --- | --- |
| `docs/work-format.md:9`「剧本用文本剧本语言写，一个场景一个文件」vs `:58`「写手一章写一次，自己分场」 | 一处说一场一文件，一处说一章一次调用 | 写手一次输出整章文本、内含多个 `scene` 块；代码按 scene 块拆成 `<场景ID>.nvs` 落盘 | 「模型一次输出整章剧本，内部以 `scene` 块分场；应用按块拆分，一块一个 `<场景ID>.nvs` 文件」 |
| `docs/work-format.md:70` 指令全集 M1a 定稿 | 只给了指令名，没参数词表 | `@camera`/`@zoom` 词序漂移、`@filter`/`@particle` 需 `none`、`@mask` 无参数定义 | 把 `out/grammar-draft.md` 的 §3 表作为 M1a 定稿底本，补：指令参数逐列词表、`none` 清除值、`@camera` 动作词表 |
| `docs/work-format.md:84`「对白、独白、旁白行尾写 cont（在句子 ID 前）」 | cont 在 ID 前 | 实测产出 `text cont #xxxx` 一致 | 无冲突；补一句「模型裸写 cont 于文本尾，ID 由保存时追加到最末」 |
| `docs/creation-pipeline.md:59`/`novelive-agent.md:83` 忠实度检查「quote 由代码核对」 | 机制 | 9/9 引文核验真 | 保留；建议加「quote 核验失败时把『引文不在该段』连同正确段回给模型重交」 |
| `agent-orchestration.md:120` open question「美术导演分批」 | 未定 | 整章模式格式合规率、token 双赢；分批仅在超窗时用 | 决策改「默认整章；剧本超上下文时按场景分批，分批需补丁方言规范化层+累积资产名约束」 |
| `handoff-defaults.md:51`「分批时每批带本批场景+前后各一场衔接+全章图清单累积」 | 衔接方案 | 累积 manifest 已带仍出命名漂移 | 补「分批模式 manifest 命名以首次出现为准，后续批次引用已有 asset 不得改 costume 段；补丁解析器做方言规范化」 |
| `novelive-agent.md:33` 转换判定表 | 「他想」类标 inner | 第三人称叙述思想标 inner 后声口断裂（文风审稿抓到） | 转换表补：「第三人称思想句→(inner) 时改写为第一人称心声；不改写则保留为旁白」 |
| `docs/bible.md:86` 伏笔「单章最多约 2 条」 | 代码把关上限 | 综合产出 42/24 ≈1.75/章，但混 narratorial 预示 | 预览 schema 的 `foreshadowingHints` 说明补「只报读者可见的未解释钩子，不报叙述者预示/评论」；综合再筛 |
| `docs/bible.md:105` 术语表「作品里的写法」 | 字段名 | 模型填成书名 | 字段文档补「同语言制作时与原文写法相同（照抄原文写法列）」或 schema 改名 |
| `creation-pipeline.md:70` 降敏重写 | 写手按降敏规则改写一次再写 | 文本侧实测有效（信息保留、覆盖不变）；无真拒答环境 | 建议把降敏句模板写进写手内置提示词（而非临时指令），「去具象词、改氛围侧写、保情节信息」三要素保留 |

## 4. 需要所有者取舍的事

A. **美术导演默认形态**：整章（推荐）——格式合规率、token、manifest 一致性全面胜；分批只做超窗兜底并强制规范化层。
B. **`(inner)` 的第三人称问题**：推荐「第三人称思想→inner 时写手必须改第一人称声口」写进转换表（文风审稿已验证能抓）；备选全部归旁白，损失 VN 独白表现力。
C. **伏笔口径**：推荐预览阶段就收紧（只报钩子不报预示），上限 2/章保留——省综合侧筛选和渲染窗口。
D. **剧本输出单位**：推荐明确「一章一输出、内含多 scene 块」（已验证、可机检覆盖）；备选一场一输出费 token 且丢跨场连贯。
E. **分批补丁方言**：若保留分批，推荐 `normalize_patch_text` 思路（宽容解析+错误回报）而不是更严 schema——模型在批次小上下文里守格式的能力实测就是差。

## 5. 可直接拿去用的产物

- `.workflow/evidence/spikes-r3/text-pipeline/out/`：`bible.json`（52 角色/42 地点/47 时间线/42 伏笔+风格）、`glossary.json`（66 条）、`skeleton.json`（4 卷骨架）、`ch01.nvs` `ch02.nvs` `ch23.nvs`（写完+审完+修完+演出完，含句子 ID）、`chNN.images.json`（图清单）、`grammar-draft.md`（M1a 语法表草案）、`README.md`（格式说明）。
- `.workflow/evidence/spikes-r3/text-pipeline/prompts/`：9 份最终提示词（preview/volume-split/synthesis/writer/review-fidelity/review-style/repair/artdirector/artdirector-batch）——v1 一轮通过全部验收，无 v2。
- `.workflow/evidence/spikes-r3/text-pipeline/src/nvs.py`：.nvs 机械解析器（指令表、标签校验、覆盖检查、诊断带 code/line/col/hint）——可当 M1a 解析器的语义参考实现。
- `.workflow/evidence/spikes-r3/text-pipeline/src/common.py`：段落规范化+pNNNN 分配+按 provider 分档的 token 估算（k 表对齐 zh-tokens 报告）。
- `.workflow/evidence/spikes-r3/text-pipeline/work/usage.jsonl`：52 条调用级 token 记录，可直接重算成本。
- 分批补丁方言规范化层：`normalize_patch_text`（在会话中，可复制到 src）——覆盖 `before N:`/`after N:`/`N+`/`L<d> insert-*`/`keep N:`/`delete N` 等 8 种方言。

## 成本与时间（对账用）

docs 没有整书 token 预估可对账（zh-tokens 报告只有原文 token 表：138k 字 ≈ deepseek 8.0 万 / cl100k 16.8 万原文 token；本实验生产侧总调用 1.06M tok ≈ 原文的 6-13 倍，因为输入含原文+上下文+输出剧本）。时间上：预览 24 章并发 <1 分钟；单章生产（写+审+修+演）在 eval 模型上合计 3-5 分钟一章（含 3 次大调用串行）；24 章串行生产估 ~1.5-2.5 小时文本侧（不含出图），与「一章要写好几分钟」（decisions.md 2026-11-21 写入前核对）一致。

## 追加：改编强度与句长

动机：初版 ch01 旁白近乎逐段抄原文——78 行中位数 61 字、p90 125、max 190，超 90 字的 28 行。原型对话框 `width:min(88%,1060px)` + 22px 字号 + 行高 1.9（prototype PlayerPage.tsx:832-867）实测一屏约 45 字×2-3 行 ≈ 90-135 字；docs 对三档强度和句长上限都没有量化定义。docs/player.md:101 的自动播放时长公式 `1.2s+0.08s×字数` 也暗示它预期短句。

### 三档实测（ch01，同书同场景）

| 指标 | 忠实 | 平衡 | 精简 |
| --- | --- | --- | --- |
| 行数 | 121 | 56 | 54 |
| 句长 中位/p90/max | 52/75/90 | 47/68/82 | 24/31/33 |
| 超 90 字行 | 0 | 0 | 0 |
| 对白/独白/旁白 | 5/9/107 | 5/8/43 | 6/12/36 |
| 覆盖恰一次 | 通过 | 通过 | 通过 |
| 忠实度 issue | 1 minor(inner 声口) | 2 minor(漏一派别+引语小改) | 5 minor(漏 2 整段+3 处引语改写) |
| 写 in/out tok | 6,864/6,219 | 6,849/2,659 | 6,850/1,438 |
| 审稿 in tok | 12,524 | 8,964 | 7,743 |
| judge 可读性(0-3) | 0.32「像电子书」 | 0.83 | 1.04 |
| judge 密度合适率 | 0.43 | 0.64 | 0.78 |
| judge 保原味(0-3) | 2.69 | 2.30 | 2.27 |

盲评（judge_batch，三份打乱顺序的同场景节选）：忠实版被判「电子书贴进来」概率 73%；精简版可读性最高但忠实度最差（漏了整派车夫和引语措辞）；平衡版居中偏可玩。

### 长旁白怎么留：结论

不在播放器做自动分页（快照/回滚/已读都按句子 ID 对，播放器内分页会让一句物理上变多次点击，snapshot 的「当前句」语义就乱了——player.md:81-97 快照字段里没有「句内页」字段）。**在写手侧拆行**：一段原文拆成多条连续行、除末条外带 `cont`，每条 ≤90 字；检查器对 >90 字行发 W_LINE_LONG（警告）、>120 字发 E_LINE_TOOLONG（退回写手）；source 范围不变（多条行同属该 scene 的 source 区间，句子 ID 各自独立、互不影响）。忠实档允许 120 上限+逐段拆行（保原文句子序），平衡档 90，精简档 60 且允许整段压成短旁白。

### 建议写进 docs/creation-pipeline.md 的量化定义

```
| 改编强度 | 忠实 | 平衡(默认) | 精简 |
| 行句长上限(CJK) | ≤120 | ≤90，目标30-70 | ≤60，目标15-45 |
| 段落→行 | 一段≥1行，按原句序拆 | 一段1-3行，可合并 | 一段可压成0-2行短旁白(仍计入覆盖) |
| 对白 | 原句保留 | 原意口吻保留，可微调 | 原意保留，允许压缩 |
| 叙述/评论 | 保留 | 长描写压短旁白 | 只留推进剧情必需节拍 |
检查器: >90 字行=W_LINE_LONG；>档上限=E_LINE_TOOLONG 退回
```

产物：`out/strength/ch01.{faithful,balanced,lean}.nvs`（三档原始输出）、`out/ch01.balanced-v2.nvs`（平衡档定稿，推荐格式形态）、`prompts/writer-strength.md`（含 {LEVEL_NAME}/{LEVEL_RULE}/{LENGTH_RULE} 三占位）。
