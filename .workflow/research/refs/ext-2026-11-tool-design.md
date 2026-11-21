# Research: 工具设计与结构化输出的业界做法与可搬资源

2026-11-21 调研。目标：给 Novelive Agent（pi-agent-core 1.6.0 + pi-schema，Node 24）的工具面、输出契约、`apply_staging_patch` 补丁格式和编辑器差异列表找可拷贝或可参照的实现与证据。读过的源码：`/tmp/pi16`（pi 1.6.0 dist）、`/tmp/omp-src`（oh-my-pi 编辑引擎）、`/tmp/aider`（编辑格式与基准文档）、`/tmp/jsonrepair`、`/tmp/partial-json`、`/tmp/instructor-js`、`/tmp/baml`（jsonish）、`/tmp/outlines`、`/tmp/llguidance`。官方文档原文存档在 `local://1803.log`（OpenAI SO）、`local://1828/1839.log`（Anthropic strict tool use + structured outputs）、`local://1863.log`（Gemini structured output）、`local://1881.log`（DeepSeek tool calls）。

## 结论先行

1. **我们已有的「一步到位动作」原则与 Anthropic 官方工具指南方向一致且更严**，不需要改方向。需要吸收的是它没写进我们设计的三条细则：工具返回只给高信号语义字段（不给内部 ID）、截断/错误时给可照做的指令、工具描述当新员工入职文档写（3–4 句起、含"何时不要用"）。
2. **`apply_staging_patch` 推荐：行锚点补丁（hashline 的简化子集），不是 aider SEARCH/REPLACE、不是 unified diff。** 理由在「补丁格式」一节：`.nvs` 是行语言、代码掌握原文（模型不背旧文）、句内 ID 恰好可当锚点、出错面可枚举成诊断码。
3. **pi-ai 已内建 strict 模式降级链**（`constrainedSampling: {type:"json_schema", strict:"prefer"}`），schema 写"全 provider 安全子集"即可让它生效；我们缺的只是提交工具上标 `strict:"prefer"` 这一条一行的事。
4. **单次调用角色的 JSON 输出：pi-ai 已依赖 `partial-json`（MIT）+ 自带 `repairJson` 控制字符修复**；jsonrepair（ISC）作为"仍失败再修"的最后一级可装可不装，建议装上，~30KB 零依赖。
5. **Schema 最大坑：三家 strict 实现互不相同**（OpenAI 全 required、Anthropic 无递归+联合计数上限、Gemini 忽略长度约束），pi-schema 的 `opt`/`union`/`map`/`recursive`/`tuple` 在 strict 下全有雷。工具参数和单次调用 schema 需要按「兼容子集」写（见下表）。

## 各项调研

### 1. Anthropic《Writing effective tools for agents》（2025-09-11）

来源：anthropic.com/engineering/writing-tools-for-agents。逐条对照我们设计：

| 原则 | 我们现状 | 判断 |
| --- | --- | --- |
| 工具按"agent 能做的事"合并，不包底层 API | 已是核心原则（`draw_image` 一个工具做完出图+检查+存文件） | 一致，维持 |
| 命名空间前缀（`asana_search`/`jira_search`） | 我们的工具名按角色作用域，天然带命名空间（`propose_*`、`read_*`、`submit_*`） | 一致 |
| 返回只给高信号字段；给模型语义名不给 UUID | 提议返回 `提议 ID`、读工具返回 `ChapterPreview`；`ImageManifest` 已让模型只写素材名 | 一致；`read_scene` 返回里若带内部行号/句子 ID 是给模型看的，保留（它是补丁锚点） |
| 截断要配"怎么更高效"的指引 | 大结果转存已有（oh-my-pi 加固），但转存结果里要写清楚"这只是预览，全文在 X，用 read_scene 区间读回" | 补一句文案 |
| 错误响应写"可照做的改进"而非错误码 | pi-scaffolding 已定"报错写成能照着改的说明"；omp hashline 的 `unseen_lines_message` 是最好的范例（错误里直接给 `re-read` 的具体调用写法，见 `/tmp/omp-src/crates/edit/src/modes/hashline/messages.rs:978`） | 照抄这个模式 |
| 描述当入职文档写（3–4 句+何时不要用+参数含义） | 内置提示词由我们写，尚无模板 | M1b 写工具描述时按这个 checklist |
| `input_examples` 字段（Anthropic 专属） | pi-ai 的 `Tool` 接口没有这个字段 | 只走 Anthropic 时可在 provider 层补；不做，描述写清楚即可 |
| 用 eval 迭代工具（含"期望调用哪些工具"的核对） | 质量评测集已定（decisions 2026-11-21） | 评测集里给提议工具加一条"该用哪个 propose_*"的标注维度 |

verdict：**只参考**（官方文章，无代码可拷），但它证实了我们方向。要点已并入上面的 checklist。

### 2. 结构化输出的服务商能力矩阵（决定 schema 怎么写）

**OpenAI Structured Outputs**（`developers.openai.com/api/docs/guides/structured-outputs`，2026 现行版）：

- 支持类型：string/number/boolean/integer/object/array/enum/`anyOf`。支持 `pattern`、`format`（date-time 等 8 种）、`minimum`/`maximum`/`multipleOf`、`minItems`/`maxItems`。
- **硬性要求**：根必须是 object；**所有字段必须进 `required`**（可选字段用 `anyOf:[...,null]` 或 `type:["string","null"]` 表达，模型仍会返回这个 key）；**每个 object 必须 `additionalProperties:false`**。
- 不支持：`allOf`/`not`/`dependentRequired`/`dependentSchemas`/`if`/`then`/`else`；`oneOf` 不支持（用 `anyOf` 替代）；根 `anyOf` 不支持。
- 规模上限：5000 属性、10 层嵌套、120k 字符的属性名/枚举值总量、枚举总值 1000 个（>250 个时单枚举 15k 字符）。
- 递归 `$ref`/`$defs` 支持。
- key 顺序 = schema 顺序（写提示词可以依赖这个）。
- edge case：`refusal` 独立字段、`incomplete_details.reason:"max_output_tokens"`。

**Anthropic strict tool use**（`platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use` + `build-with-claude/structured-outputs#json-schema-limitations`，stable，2026-10-21 API）：

- 支持：基本类型、`enum`/`const`（简单值）、`anyOf` 和 `allOf`（有限制）、`$ref`/`$defs`/`definitions`、`default`、`required`+`additionalProperties:false`（object 必须）、string format（10 种，含 `uri`）、`minItems` 只支持 0/1、`pattern` 受限（无反向引用/环视/`\b`/大 `{n,m}`）。
- **不支持：递归 schema**；`oneOf`；`not`；`anyOf` 与 `type`/`properties` 同层；冲突或含 `$ref`/`anyOf`/`allOf` 的 `allOf`；枚举里放复杂类型；外部 `$ref`；数值约束（minimum/maximum/multipleOf）；`minLength`/`maxLength`；`minItems`>1、`maxItems`、uniqueItems 等数组约束；`additionalProperties` 非 false；object 空 `properties` 只能产出 `{}`（任意键 map 用 `[{key,value}]` 数组代替）。
- **全请求复杂度上限**：strict 工具 ≤20 个；全部 strict schema 的可选参数总数 ≤24；`anyOf`/联合类型参数 ≤16（编译代价指数）。属性输出顺序：required 在前、可选在后（与 schema 顺序无关，和 OpenAI 不同！）。
- enum/const 不保证大小写（"Conversation topic 3"→"Conversation Topic 3"），应用要大小写不敏感比较。
- 超限时返回 400「Schema is too complex for compilation」；编译超时 180s。
- 缓存的 schema 不算 PHI，PHI 不能进属性名/枚举/pattern。
- Zod/Pydantic SDK helper 会自动变换不支持的约束（`zodOutputFormat`）。

**Gemini structured output**（`aistudio.google.com/docs/structured-output`，`response_format:{type:"text",mime_type:"application/json",schema}`）：

- 类型：string/number/integer/boolean/object/array/null（`type:["string","null"]`）。
- object：`properties`/`required`/`additionalProperties`（可为 bool 或 schema，即支持 map）；`minProperties`/`maxProperties` **被忽略**。
- string：`enum`/`format`；`minLength`/`maxLength`/`uniqueItems`/`contains` 等**被服务端剥离忽略**（不报错，悄悄丢掉），需代码层校验。
- number/integer：`enum`/`minimum`/`maximum`。array：`items`/`prefixItems`/`minItems`/`maxItems`（这两项生效）。
- 复杂上限内部定：语法状态机的状态数/分支/嵌深，超了返回 `400 INVALID_ARGUMENT`；递归 `$ref` 要把递归点设为可选/nullable，不许出现在 required 链或 `minItems>0` 的数组里。
- 简化建议官方原文：把非结构约束挪进 `description`、扁平化、`anyOf`/enum/optional 是状态数大户、属性名长短也占状态。
- 工具面（`functionDeclarations`）与 SO 不同：`parametersJsonSchema` 是全 JSON Schema（含 `anyOf`/`oneOf`），`const` 被 Gemini 忽略、pi-ai 自动改写成单值 `enum`（`google-shared.js:359-380`）；strict 采样只支持 Gemini 3+（`supportsGoogleStrictToolSampling`，`google-shared.js:410`），旧模型发非 strict。

**DeepSeek**（`api-docs.deepseek.com/guides/tool_calls`）：strict 模式 Beta，要 `base_url=api.deepseek.com/beta`，所有 function 都设 `strict:true` 才生效。schema 子集约等于 OpenAI（object/string/number/integer/boolean/array/enum/anyOf/`$defs`+`$ref`含递归），但 **object 全 required + `additionalProperties:false`**；`minLength`/`maxLength`/`minItems`/`maxItems` 不支持。JSON Output（非 strict 工具）只有 `json_object` 模式，提示词里必须出现 "json" 并给例子，且可能返回空 content。

**Qwen / 阿里 Model Studio**（`help.aliyun.com/en/model-studio/qwen-structured-output`）：`json_object`（要求消息里含 "JSON"）和 `json_schema`+`strict:true`（Qwen3.7/3.8 系列）两档；限制基本与 OpenAI 对齐。未找到工具参数 strict 的独立文档——按 OpenAI 兼容端点发就行，不单独适配。

**pi-ai 已经替我们做的**（`/tmp/pi16/node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js`、`anthropic-messages.js:1489`）：

- `Tool.constrainedSampling = {type:"json_schema", strict:"prefer"|"require"}`。`prefer` = 能 strict 就 strict，schema 超出该 provider 子集就静默退回非 strict；`require` = 不行就抛错。
- `makeStrictJsonSchema` 自动：拒绝根非 object、递归下推 `additionalProperties:false`、把不在 `required` 里的属性包成 `anyOf:[...,{type:"null"}]`（OpenAI 语义）、拒绝 `$ref`/`allOf`/`oneOf`/tuple/items 数组/无 type 节点/object 或 array 的联合（联合里不能有结构化 schema！）。
- Anthropic 侧再过滤一遍 `ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS`（数值/长度/数组约束 + format 白名单 + `minItems`∈{0,1}），并对 root 剥成 `{type,properties,required,additionalProperties,$defs,definitions}`——根 `anyOf`/`oneOf`/`allOf` 直接丢。
- Google 侧 `resolveJsonSchemaStrictSampling(tool, supportsStrictMode)`（`google-shared.js:396`）。
- OpenAI 兼容 provider 由 compat flag `supportsStrictMode` 决定（`openai-completions.js:1143`，不支持就不发 `strict` 字段）。
- 超 Anthropic 复杂度上限时 `strict_tool_limits` 会降级重发（`anthropic_strict_tools_fallback` 事件）并在 session 里记，需要 `cleanupSessionResources`。

**pi-schema 输出对照表**（源码 `dist/builders.js`）与三家 strict 的兼容：

| pi-schema 构件 | 产出的 JSON Schema | OpenAI strict | Anthropic strict | Gemini SO | DeepSeek strict |
| --- | --- | --- | --- | --- | --- |
| `obj`（默认 closed） | `type:object`+`required`（非 opt 的）+`additionalProperties:false` | ✓（非 opt 字段本来就在 required） | ✓ | ✓ | ✓ |
| `opt(str())` | 属性不进 `required` | ✓ pi-ai 自动补 `anyOf:[..,null]` | ✓ 但计可选参数（≤24/请求） | ✓ | ✓ 同 OpenAI 语义 |
| `nullable(s)` | `anyOf:[s,{type:null}]` | ✓ | ✓（计 union） | ✓ | ✓ |
| `oneOf([..])` | `enum` | ✓ | ✓ 大小写不保证 | ✓ | ✓ |
| `union` | `anyOf` | ✓ 但根不行；object/array 联合 pi-ai 直接拒 | ✓（≤16 个 union 参数/请求） | ✓ | ✓ |
| `lit` | `const` | ✓ | ✓ | **SO 忽略 const**（改 `oneOf` 单值 enum；工具面 pi-ai 已自动改写） | ✓ |
| `str({pattern,format})` | `pattern`/`format` | ✓ | 受限 pattern、format 白名单（无 pattern 时 OK） | format 仅提示、不强制 | `pattern`/`format` 部分支持 |
| `str({minLength,maxLength})` | 长度约束 | ✓ | **400 拒绝**（strict 下） | 静默忽略 | 不支持 |
| `num/int` bounds | `minimum` 等 | ✓ | **400 拒绝** | ✓ | ✓ |
| `arr` min/maxItems | `minItems`/`maxItems` | ✓ | minItems∈{0,1}、无 maxItems | ✓ | 不支持 |
| `tuple` | `prefixItems`+`items:false` | pi-ai `UNSUPPORTED`（tuple） | **不支持** | ✓ prefixItems | 不明 |
| `map(v)` | `additionalProperties:v` | **破坏 additionalProperties:false 要求** | 只能返回 `{}` | ✓ | 不支持 |
| `recursive` | `$id`+`$ref` | ✓（`$defs` 形式） | **不支持递归** | 受限（递归点须可空） | `$defs`/`$ref` 支持 |
| `unknown()` | 无 type | pi-ai 拒（"schemas without a type"） | — | — | — |
| `obj(...,{open:true})` | 无 `additionalProperties` | strict 被拒 | strict 被拒 | ✓ | 不支持 |

**落地规则**（写进我们 schema 约定，一句话）：给模型面（工具参数 + 单次调用输出）的 schema 用"保守子集"——不用 `map`/`tuple`/`recursive`/`unknown`/`open`/`minLength`/数值边界；`union` 只联合标量（`oneOf`/`lit`/`nullable` 这类），联合成员的判别写进 `description`；可选字段一律 `opt()`；内部数据格式（bible/preview/chapter.json 校验用）不受此限，爱用什么用什么。

### 3. 工具结果/错误写法的实证

- Anthropic 工具文章 + Claude Code 文档：错误文本 = 模型下一轮读到的东西，要写"可照做的指令"（`labuladong`/`karigor` 等二手文章同结论，可信度以官方为准）。
- omp hashline 的错误文本是最好的现成范例，全部在 `/tmp/omp-src/crates/edit/src/modes/hashline/messages.rs`：
  - `unseen_lines_message`（:978）：先说错在哪（"anchors to lines 5-7 that [path#TAG] never displayed"）→ 直接给修正动作（"Re-read them in full first with a ranged read like `path:5-7`"）→ 甚至把实际文件内容贴进错误里让模型立即重发。
  - `PARSE_FAILURE_NOTICE`/`PARTIAL_NOTICE`（`modes/sloppy/types.rs:41`）：整体失败要求重发完整 payload；部分失败只要重发被拒的 op——这就是"工具结果当指令"的字面实现。
  - `format_mismatch_message`/`stale_unseen_lines_message`：tag 过期时把活文件当前 tag 和行号映射给出来，而不是只说"stale"。
- 我们 `pi-scaffolding.md` 已写"错误文本教模型怎么改"（来源就是 omp）。增量：每条错误固定三段式 = 发生了什么 + 合法写法/一个例子 + 下一步该调用什么。这个模式适合 `apply_staging_patch` 的诊断、`submit_*` 校验失败、`draw_image` 审核拒绝的回话。
- `AgentTool.execute` 语义（`pi-agent-core/dist/types.d.ts:432`）：失败就 throw 或返回 `isError:true`，不要只在 content 里描述失败——和我们设计一致。

### 4. 流式 JSON / 容错解析

| 库 | 许可 | 干什么 | 我们的用法 |
| --- | --- | --- | --- |
| `partial-json`（npm 0.1.7） | MIT | 解析未完结 JSON（流式增量），可指定哪些类型允许截断 | **pi-ai 已依赖**（`pi-ai/dist/utils/json-parse.js:1`）：`parseStreamingJson` 用它，我们自己不要再装一遍 |
| pi-ai `repairJson` | MIT（包内） | 字符串内控制字符转义、非法 `\x` 转义反斜杠翻倍 | 已在 `parseJsonWithRepair` 里用；单次调用角色解析失败时先走这层 |
| `jsonrepair`（npm 3.15.0，josdejong） | ISC ≈ BSD-2-Clause | 全量容错：单引号、缺引号、尾逗号、markdown 围栏、JS 注释、Python None/True、URL、十六进制…… 有 streaming core | **建议装**：~30KB 零依赖，作为"partial-json+repairJson 之后仍失败"的最后一级；`stream:true` 时也可用 streaming core 做增量 |
| BAML `jsonish`（`/tmp/baml/engine/baml-lib/jsonish`，Rust） | Apache-2.0 | markdown 抽取+多 JSON+修复+union 判别，绑定 LLM 输出解析的全套 | **只参考**：是 Rust+wasm，太重；它"先 serde 再修、修不了再 markdown 抠"的三段式和我们"先 JSON.parse 再 repairJson 再 jsonrepair"顺序一致 |
| `zod-stream` / `instructor-js` | MIT / BSD-2-Clause | Zod schema→response_format/tools mode 适配、流式部分对象回填 | **只参考**：绑死 OpenAI client；provider mode 降级链（TOOLS→JSON_SCHEMA→MD_JSON）的思路已被 pi-ai 内建 |
| Outlines（Python）、guidance/llguidance（Rust） | Apache-2.0 / MIT | 语法约束解码（本地推理） | **不要**：我们是 API 模型，约束只能交给 provider 的 strict 或提示词 |

### 5. 补丁/编辑格式证据

**Aider 基准**（`aider.chat/docs/benchmarks.md`，2023-07，GPT-3.5/4 时代；leaderboard 现行版用 `diff`）：

- 四种格式测过：`whole`（全文 fenced）/ `diff`（`<<<<<<< SEARCH`/`=======`/`>>>>>>> REPLACE` 块）/ `whole-func` / `diff-func`。
- GPT-3.5：`whole` 最稳（46% vs diff 30%，且 diff 常把全文塞进 SEARCH/REPLACE 两边）。GPT-4：`whole`≈`diff`，但 whole 成本高得多 → 选 diff。
- function-call 形式的编辑格式全面更差（幻觉 function_call、往 arguments 塞裸文件）。
- `udiff` 只留给 `gpt-4-turbo`（GPT-4 Turbo 在 unified diff 上反而懒编码减少，2023-12 blog）；现行 `models.py` 里强模型全部 `edit_format="diff"`，仅少数推理模型 `editor_edit_format="editor-diff"`。
- 结论适用边界：Aider 的模型要自己背原文写 SEARCH 块；我们的美术导演也自己写补丁锚点，但**我们有 parser 诊断回环**（`apply_staging_patch` 解析器校验，错了退回）。

**omp 编辑引擎**（`/tmp/omp-src/crates/edit`，MIT）五种模式：

| 模式 | 格式 | 适用 |
| --- | --- | --- |
| `replace` | `old_string`/`new_string` 对 | 单点小改，非唯一要 `replace_all` |
| `patch` | `@@` anchor + ` `/`+`/`-` 上下文 hunk | 代码编辑主力 |
| `apply_patch` | OpenAI 同款 `*** Begin/Update File/@@` | 兼容 |
| `hashline` | `[path#TAG]` + `PUT/CUT N.=M:`、`PUT <N:`/`>N:`、块 `N*`、clipboard 寄存器、tag 过期自动 remap | 行锚点，hash 保护并发 |
| `sloppy` | `*** Edit File:` + `*** Find/Replace/Insert After/…` + `*** Replace Block:`，单字符串输入，模糊匹配（normalize Unicode/whitespace，levenshtein ≤0.95） | 一句话 payload、对格式错最宽容 |

- hashline 的 tag = 4 hex 内容快照（`format.rs`），过期时 `recovery.rs` 用行映射表尝试 remap + `context_preserved`/`parses_cleanly` 守卫，恢复不了才给 stale 错误。这套**防并发漂移**对我们 `apply_staging_patch` 价值有限——美术导演循环里 `.nvs` 是独占的，不会被别人改；但"按行号锚 + 错误里带实际内容"的设计直接可抄。
- sloppy 的设计目标（"一个 input 字符串发完整个补丁、header 同时写动作和开头行、找块不用引旧文"）其实最贴我们场景：模型只写动作+新内容+最短定位串。它的 Find/Replace 语义 ≈ aider SEARCH/REPLACE 的宽松版。
- 每个模式都有 lark grammar（`crates/edit/grammars/*.lark`）供 provider 约束解码用——pi-ai 的 `constrainedSampling:{type:"grammar"}` 支持 `openai_lark` 变体，未来如果走支持的 provider，可以给补丁工具挂 grammar。

**BFCL V4 format sensitivity**（`gorilla.cs.berkeley.edu/blogs/17_bfcl_v4_prompt_variation.html`，2025-07，200 题×26 种格式变体）：

- 函数描述用 JSON 格式给 > Python > XML（几乎所有模型）；返回格式 Python/JSON > XML。→ 我们的工具定义走 JSON Schema 是对的。
- 失败模式：XML 返回时把每个调用各自包一层 `<functions>`、引号用法错、类型写成 `int` 而非 `integer`——都是格式而非语义错。→ 印证"格式越简单越好、能用 provider 原生工具调用就别让模型手写格式"。
- 我们 `.nvs` 是纯文本行格式、不走工具参数，属于"文本输出"范畴；补丁工具参数反而越少越好——`apply_staging_patch` 的 `patch` 参数就应该是**一整个字符串**（ sloppy 式），不要拆成结构化 ops 数组让模型填 JSON（Aider `diff-func` 已证更差，且 JSON 转义会让行内容面目全非）。

**LongFuncEval**（arXiv 2505.10570，IBM 2025-04）：工具目录 8k→120k token，准确率降 7–85%；工具结果 10k→80k token，答案抽取降 7–91%；多轮 10k→80k 降 13–40%；正确工具越靠后表现越好（recency）。→ 直接证据支持我们"每角色工具≤10 个、材料塞上下文不做查询工具、工具结果截断/转存"。

**"tool result as instructions"**：Anthropic 官方（见 §1/§3）；`AgentTool.execute` 契约（pi-agent-core types.d.ts:432）要求 throw 或 `isError:true`——不要返回"看似成功的错误文本"。

### 6. `apply_staging_patch` 与编辑器差异列表的格式推荐

**场景**：美术导演在工具循环里给整章 `.nvs` 插演出指令（`@bg`/`@show`/`@camera`/`@cg`/`@particles`/`@filter`）。`.nvs` 是行语言，每行独立语义；插入为主，几乎不改写手已有的文字行；场景文件几百行量级。

**推荐：简化行锚点补丁（hashline 风格的子集）**，参数就一个字符串 `patch`，形如：

```text
[scene-0001.nvs]
PUT >7:
+@bg classroom/dusk fade 1.5
PUT >14:
+@camera focus lin-xiao slow
PUT <29:
+@particles dust light
PUT 33.=33:
+@show lin-xiao/uniform/angry left
CUT 41
```

- 行号锚（`PUT <N:`/`>N:`/`N.=M:`/`CUT N`）就够：美术导演读剧本时我们给的就是**带行号的场景文本**（工具输出 `12: lin-xiao: … #a3f9`），模型直接引行号，不用背内容——这正是 hashline `LINE:TEXT` 编号的初衷，比 Find/Replace 更省 token、更不容易错（BFCL：类型错/引号错是主失败模式；行号是整数，转义面为零）。
- **不要 `#TAG` hash**：美术导演独占场景文件，无并发写；去掉 `[path#TAG]` 要求，把 tag 改成"工具返回里带的版本号"或直接省掉，省一个出错点。omp 的 tag 机制为并发防漂移设计，我们用不上。
- **不要 clipboard 寄存器、`MV`/`REM`、块 `N*`**：演出补丁几乎全是插入单行，偶尔替换/删除单行；`PUT`/`CUT`/`PUT <`/`PUT >` 四个 op 覆盖。`block` 模式（`PUT >N*` 按语法块插）对 `.nvs` 没意义——它没有嵌套块。
- 错误回环复用 omp hashline `messages.rs` 模式：解析失败给"合法写法+一个完整例子"；行号超界/锚点行不存在给该行附近的实际内容（`format_anchored_context` 的思路，±2 行上下文）。
- 工具参数 schema：`obj({ patch: str({description:"…"}) })`，可选 `obj` 包一层 `ops`？**不要**——保持单字符串（上面 §5 Aider diff-func 证据 + BFCL JSON>XML 证据）。

**编辑器重写场景的差异列表**：维持已定设计（模型输出整场新文本，代码按句 ID diff）。它和补丁格式不冲突：重写是"全文改写"，补丁是"插入指令"；模型在编辑器里写的是创作文本（整段重写是自然产出形态），在导演循环里写的是机械插入（锚点操作是自然形态）。两个格式分开是对的，不用统一。

**不要**：unified diff（hunk 行号要算 `@@ -a,b +c,d @@`，模型算错率高，aider 只给特定模型用）；XML 包裹（BFCL 证实差）；让模型写 `old_string`/`new_string`（中文长对白行复制成本高、容易引号/转义错）；结构化 `edits[]` JSON（diff-func 证据 + JSON 转义会毁掉 `.nvs` 里的 `{whisper}…{/whisper}` 标签可读性）。

### 7. 对我们工具清单的核对

对照 `novelive-agent.md`/`pi-scaffolding.md` 的工具表，要加/改的：

| 项 | 现状 | 建议 |
| --- | --- | --- |
| `apply_staging_patch` 参数 | 未定格式 | 用上面 §6 的行锚点字符串 patch；工具内部先校验"行号存在、范围不倒、锚点行是文本行还是 @ 行"再解析应用 |
| `submit_*` 工具 strict | 未提 | 参数 schema 满足兼容子集后，给工具加 `constrainedSampling:{type:"json_schema",strict:"prefer"}`（pi-ai 原生字段，一行） |
| 单次调用 JSON 解析链 | "解析失败把错误还给模型" | 明确三级：JSON.parse → pi-ai `repairJson`/partial-json 同款 → jsonrepair（ISC）；全失败才回错误。错误里贴"缺哪个字段/哪行非法" |
| 工具描述写法 | 未定 | M1b 按 Anthropic checklist 写：3–4 句、何时用/不用、每个参数一句含义、返回什么；`draw_image`/`apply_staging_patch`/`propose_*` 描述里嵌入一个完整合法例子（Anthropic 证实 example 有效；`input_examples` 字段不做） |
| 错误文本 | "能照着改的说明" | 三段式固定模板：错误 + 合法写法/例子 + 下一步动作；`apply_staging_patch` 诊断直接搬 hashline messages.rs 文案模式 |
| 工具数 | 主控 ~15 个（6 读 + 8 提议 + list + 子 agent） | 已到上限边缘（Anthropic 文档建议合并）。提议工具可以合并成 `propose_change { kind, target, changes, reason }`？——不要，按我们"一事一工具"原则；但要意识到 15 是软上限，别再加 |
| 提议 schema | `changes` 是条目字段的子集 | `changes` 用条目 schema 的 `opt()` 版（全部 opt），避免 map/union 进 strict |
| `list_proposals` 等只读 | 无 | 可加 MCP 语义注解（readOnlyHint 等）只在我们内部概念里用：区分"只读工具"让调度/权限清晰，不进接口（MCP 注解本身是给 MCP server 的） |
| 句 ID 当锚点 | 模型保留原行尾 `#xxxx` | 补丁 op 里允许 `PUT >#a3f9:` 这种 ID 锚？**不要**：行号已经够，双锚点系统只会让诊断复杂。行号从工具输出的带行号视图来 |

## 可拷贝/可参照清单（按价值排序的 Top-15）

1. **pi-ai `constrainedSampling` + `makeStrictJsonSchema`**（MIT，`dist/api/constrained-sampling.js`）— 直接拷贝用法：提交工具标 `strict:"prefer"`，schema 写兼容子集；已是依赖，零成本。
2. **omp hashline 的行锚点 op 集 + 错误文案模式**（MIT，`/tmp/omp-src/crates/edit/prompts/hashline.md`、`modes/hashline/messages.rs`）— 移植改写：抽 `PUT`/`CUT`/gap-locator 四 op + `LINE:TEXT` 编号视图 + "错误里带实际内容和下一步调用写法"的文案模板，落 `creator` 包的 `apply_staging_patch`。
3. **jsonrepair**（ISC，npm 3.15.0，零依赖）— 直接拷贝（装包）：单次调用角色 JSON 修复最后一级。
4. **pi-ai `repairJson`+`partial-json` 链**（MIT，已在依赖里）— 直接用，别另写。
5. **Anthropic 工具设计 checklist**（官方文章）— 只参考：M1b 写工具描述时逐条核。
6. **OpenAI/Anthropic/Gemini/DeepSeek schema 子集表**（官方文档，本文 §2 表）— 直接落地为"模型面 schema 写作规则"。
7. **omp `stream_json.rs` ArgSnapshot**（MIT）— 只参考：pi-ai 已给 `toolcall_delta`+`parseStreamingJson`，对话面板要增量显示提议卡时复用这个思路，不装 omp。
8. **Aider SEARCH/REPLACE 与 benchmark 文档**（Apache-2.0）— 只参考：补丁格式决策的反例证据（`diff` 好是因为模型强、whole 费 token；我们行锚点比两者都省）。
9. **omp sloppy 模式**（MIT，`modes/sloppy/`）— 只参考：单字符串 payload + 模糊匹配的设计确认了我们"patch 就一个字符串参数"的选择；不引它的 Find/Replace（行号更省）。
10. **LongFuncEval / BFCL V4**（CC-BY-4.0 论文 + 官方博客）— 只参考：工具数量≤10、结果截断、JSON 描述格式的实证依据。
11. **`prepareArguments` shim**（pi-agent-core `AgentTool`，MIT）— 直接用：工具参数过 schema 前的最后修复点（如模型把可选字段写成 `"null"` 字符串）。
12. **Anthropic strict 复杂度上限（20/24/16）**— 只参考：我们提议工具多而 schema 复杂，若发现 strict fallback 频繁，先减可选参数/union 而不是关 strict。
13. **BAML jsonish 三段式解析顺序**（Apache-2.0）— 只参考：验证了我们"parse→repair→markdown-extract"顺序，不装 wasm。
14. **instructor-js provider mode 降级表**（BSD-2-Clause）— 只参考：TOOLS→JSON_SCHEMA→MD_JSON 的降级思维与 pi-ai `prefer` 同构。
15. **MCP ToolAnnotations 四 hint**（spec 文档）— 只参考：内部给工具标只读/副作用，不进线上接口；提议工具标 `destructiveHint` 语义对应"要确认闸门"。

## 和我们现有设计冲突或缺口

- **`opt()`/`union`/`map`/`recursive`/`tuple`/`unknown`/`open` 在 strict 下全是雷**（§2 表）：我们内部数据 schema 已用 `opt` 和 `union`（`BiblePatch` 的 status、条目 changes）。规则：同一 pi-schema 定义当两个角色用——内部校验面（全特性）和模型面（工具参数、单次调用输出契约）可以共享定义，但模型面那批必须人工过一遍兼容子集；`changes` 这类"字段可选集"用全 `opt()` 而非 `map`。**目前设计文档没写这条边界**。
- **Anthropic 属性顺序 = required 先可选后**（与 OpenAI schema 顺序不同）：如果我们在单次调用契约里靠"先输出 summary 再输出条目"的顺序暗示思维链，Anthropic strict 会破坏它。需要"顺序无关"的契约或干脆接受。
- **enum 大小写不保证（Anthropic）**：`IllustrationPick.lookHint`、`BiblePatch.status` 这类枚举要么全小写无歧义，要么代码层 `toLowerCase` 比对——pi-schema validator 是严格匹配的，校验前做一次大小写归一（`prepareArguments` 或单次调用解析层）。
- **`optional` 参数成本**：Anthropic 全请求可选参数 ≤24。主控提议工具若每个都有 `reason`+可选 `instruction`，合计容易触顶 → `reason` 设 required（模型必须给理由，本来也是我们的原则）。
- **`strict` 非免费**：schema 复杂度超限会自动降级（pi-ai 有 fallback 事件）；对话面板 15 个工具全开 strict 可能命中 20 上限——`prefer` 语义下静默降级，行为可接受，不用专门处理。
- **jsonrepair 引入与否**：它是 ISC（≈BSD-2-Clause），许可 OK；装它意味着第三级容错，不装也不影响主流程。倾向装上，因为 .nvs/JSON 混排文本解析失败时它能抠出 ```json 围栏里的对象。
- **补丁格式未定**是我们最大的空白：M1b 才写导演工具，现在就把"行锚点字符串 patch + 带行号视图"定下来，省得 M1b 再开一轮。
