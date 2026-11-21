# 文本模型服务商调研：缓存、批量、结构化输出与推理控制

2026-11-21。pi-ai 1.6.0（npm 2026-11-20，MIT）dist 源码逐文件复核；各厂文档与价格页 2026-11-21 抓取。

## 1. 结论

- **提示缓存能省一半以上文本成本**，但不是白来的：OpenAI（GPT-5.6+）与 Anthropic 的缓存**写入要加价**（1.25×/2× 输入价），命中才按 0.1× 计费；DeepSeek、GLM、Kimi、Qwen、Gemini 写入免费或便宜得多。我们的场景（写手/审稿/美术导演共享稳定前缀）对显式断点最敏感的是 Anthropic；对隐式缓存最省心的是 DeepSeek/GLM/Gemini/Kimi。
- **pi-ai 1.6.0 已经自动做正确的事**，但只对「能识别的地址」生效：官方 OpenAI/Anthropic/OpenRouter/DeepSeek/zai/Moonshot 地址会自动带上 `cache_control` 或 `prompt_cache_key` 或 session 亲和头；**自定义中转地址不会**（OpenAI `prompt_cache_key` 只在 baseUrl 含 `api.openai.com` 或 `cacheRetention:"long"` 时才发，Anthropic 格式只在 `model.id` 以 `anthropic/` 开头或显式设 `cacheControlFormat` 时走 anthropic 缓存路径）。
- **Batch API**：OpenAI/Anthropic/Gemini/DashScope/Kimi 都是 50%（Kimi 60%），24h 窗口。pi-ai **没有任何 batch/deferred 实现**（`fetchDeferred` 只存在于 faux provider）；我们的「全书逐章预览」是唯一适合 batch 的阶段，值得在 M1a 之后评估是否自写包装层；写剧本/审稿/演出是串行依赖链，batch 用不上。
- **结构化输出**：pi-ai 的 `submit_*` 工具标 `constrainedSampling:{strict:"prefer"}`，OpenAI/DeepSeek/GLM 走 `strict:true`（schema 被 `makeStrictJsonSchema` 压到严格子集），Anthropic 走 `strict:true` 工具（另有 `output_config.format` JSON 输出），Gemini 3+ 用 `parametersJsonSchema` + `VALIDATED` 工具调用模式。我们已定「schema 只用保守子集」完全正确，但要注意 Anthropic strict 有「可选参数 ≤24、联合类型 ≤16」的硬上限。
- **推理控制**各家格式完全不同，pi-ai 靠 `thinkingLevelMap` + `thinkingFormat` compat 字段映射：`reasoning:"off"` 并不是通配——DeepSeek 是 `thinking:{type:"disabled"}`、Qwen 是 `enable_thinking:false`、GLM 是 `thinking:{type:"disabled"}`、Kimi-K3 是 `reasoning_effort:"low"|"high"|"max"`（不支持 off）、Claude 是 `thinkingEnabled:false`、Gemini 是 `thinkingBudget:0`/`thinkingLevel`。**自定义地址的模型 pi 不会自动识别 thinkingFormat，reasoning 控制会静默失效**（发到端点不被理解的字段）。
- **成本估算**（100 章 / 30 万汉字，1 汉字 ≈ 0.8 token，五模型分工）：全部文本花费 **$5–14 区间**。最便宜是国产组合（GLM-5.3 全家或 Qwen 3.6-plus+3.7-max，约 **$5.2–6.5**），最贵是 OpenAI 组合（gpt-5.4-mini+gpt-5.2，约 **$13.6**）。Anthropic（haiku-5.5+sonnet-5.5）约 **$11.2**。这是纯文本；图片另算。

## 2. 证据

### 2.1 提示缓存机制（按厂）

**OpenAI**
- 自动隐式缓存，1024 token 起缓存、128 token 粒度；GPT-5.6+ 起缓存写入收费 1.25×（30m TTL）/2.5×（12h TTL），命中读 0.1×（GPT-5.2 $0.175/MTok 缓存读 vs $1.75 输入）。`prompt_cache_key`（≤64 字符）是「同一业务组的粘路由键」，`prompt_cache_options.ttl` 选 30m/12h。
- 来源：developers.openai.com/api/docs/guides/prompt-caching（2026-11-21 抓取）；pi-ai `api/openai-responses.js:263-265`、`api/openai-completions.js:567-570`。

**Anthropic**
- 显式 `cache_control:{type:"ephemeral"}`，最多 4 个断点；自动模式把断点放最后可缓存块。5m 写 1.25×、1h 写 2×、读 0.1×。最小可缓存长度因模型而异（Fable5.2/Mythos5.2/Opus5.5/Sonnet5.5/Haiku5.5=512；Opus4.7=2048；Sonnet5/4.6/Opus4.8=1024；Opus4.6/4.5/Haiku4.5=4096）。缓存键层级 `tools→system→messages`：改工具定义全失效，改 thinking 参数/effort 只使 messages 块失效（逐消息 effort 不破坏前缀），图片加进 messages 也使 messages 失效。
- 来源：platform.claude.com/docs/en/build-with-claude/prompt-caching（2026-11-21 抓取）；pi-ai `api/anthropic-messages.js:37-45,1076-1155,1407-1427,1489-1521`。

**Gemini**
- 隐式缓存默认开（Gemini 2.5+），命中自动按缓存价计，无写入费；最小前缀 4096（Gemini 3.1pro/3.8flash/4 系）/2048（2.5）。命中读约 0.1×（gemini-3.1-pro $0.2 vs $2 输入；3.8-flash $0.075 vs $0.75）。显式 `cachedContents` 对象 TTL 默认 1h，只到 Gemini 3（4 系不支持）。Gemini 4 多轮增量需 ≥2050 token 才缓存整段上轮请求。
- 来源：ai.google.dev/gemini-api/docs/generate-content/caching（2026-11-21 抓取）；pi-ai `api/google-generative-ai.js:168-171`（只读 `cachedContentTokenCount`，不发显式缓存对象）。

**DeepSeek**
- 自动硬盘缓存，所有用户默认开、不用改代码；按「缓存前缀单元」匹配：请求边界（用户输入末/模型输出末）、公共前缀检测、固定间隔切分。命中读：deepseek-flash 峰 $0.006 / 谷 $0.003（输入 $0.3/$0.15），v4-pro 峰 $0.044 / 谷 $0.022（输入 $1.32/$0.66）。最佳命中策略=前缀稳定。
- 来源：api-docs.deepseek.com/guides/kv_cache 与 quick_start/pricing（2026-11-21 抓取）；pi-ai `providers/data/deepseek.json`、`api/openai-completions.js:1161-1184`（`prompt_cache_hit_tokens`/`cached_tokens` 双字段）。

**Qwen / DashScope**
- 三模式：隐式（自动，命中读 20% 输入价，min 1024）、显式（`cache_control:{type:"ephemeral"}` 加在 messages 的 content 块上，写 125%、读 10%、TTL 5m、最多 4 标记、回看上溯 20 块）、会话缓存（Responses API 加 `x-dashscope-session-cache:enable` 头，计同显式）。`tools` 参数随 messages 里最后一个标记一起缓存；连续同 role tool 消息合并可保 20 块回看窗内。
- 来源：docs.qwencloud.com/developer-guides/run-and-scale/context-cache（2026-11-21 抓取）；pi-ai 无 DashScope 专门 compat，`detectCompat` 不认 `maas.qwencloudapi.com`/`dashscope`，`cacheControlFormat` 默认 undefined → **显式标记不会自动下发，隐式缓存仍可用**。

**Moonshot Kimi**
- 隐式自动缓存（无需配置），命中读 0.1×（kimi-k3 命中 $0.30 vs 未中 $3.00）；写 5m=$3/MTok、1h=$6/MTok（仅 K3 系支持写）。`prompt_cache_options.ttl` 选 5m/1h（Chat/Responses）；Anthropic 格式顶层 `cache_control.ttl`。Batch 60% 价。K3 系思考不可关（reasoning_effort low/high/max），K2.6 thinking.type 可 disabled。
- 来源：platform.kimi.ai/docs/guide/context-caching、pricing/chat、pricing/batch（2026-11-21 抓取）；pi-ai `api/openai-completions.js:1228`（isMoonshot 检测）、`providers/data/moonshotai*.json`。

**Zhipu GLM (z.ai)**
- 隐式自动缓存（beta），命中读：glm-5.3 $0.26、5.3-flash $0.03（输入 $1.4/$0.15）。缓存存储限时免费。思考 `thinking:{type:"enabled"|"disabled",clear_thinking:false}` + `reasoning_effort`。
- 来源：docs.z.ai/guides/capabilities/cache、guides/overview/pricing（2026-11-21 抓取）；pi-ai `providers/data/zai*.json`（thinkingFormat:"zai"）、`api/openai-completions.js:610-619`。

**OpenRouter**
- 透传各上游缓存；sticky routing 自动把同会话打到同一 provider 保缓存热，`session_id` 或 `x-session-id` 头（≤256 字符）或退化为 `prompt_cache_key`。Anthropic 模型 `cacheControlFormat:"anthropic"`（pi 只对 `model.id` 以 `anthropic/` 开头检测）。批式端点 `:batch` 与同步同价 50%。
- 来源：openrouter.ai/docs/guides/best-practices/prompt-caching、features/prompt-caching（2026-11-21 抓取）；pi-ai `api/openai-completions.js:526-535,1262,1299-1301`、`api/openai-responses.js:49-52,219-227`。

### 2.2 pi-ai 1.6.0 实际会发什么（dist 源码复核）

| API | 缓存行为 | 触发条件 | 文件:行 |
|---|---|---|---|
| anthropic-messages | `cache_control:{type:"ephemeral",ttl?}` 打到 system 块/最后 user|system 块/最后工具定义 | `cacheRetention!=="none"` 即默认发（default "short"，"long"+`supportsLongCacheRetention`→ttl:"1h"） | `api/anthropic-messages.js:28-45,1076-1155,1407-1427,1517-1521` |
| openai-completions | `prompt_cache_key`（截 64）+ `prompt_cache_retention:"24h"`（仅 long+支持）；OpenRouter 加 `x-session-id`/`x-client-request-id`/`x-session-affinity` 头 | `cacheRetention!=="none"` 且 `promptCacheKeyMode` 命中（auto 时仅 `api.openai.com` 或 long+supportsLongCacheRetention） | `api/openai-completions.js:143-190,516-535,550-570,784-852` |
| openai-responses | `prompt_cache_key`（截 64）+ `prompt_cache_retention:"24h"` 或 `prompt_cache_options`（`supportsExplicitPromptCacheMode` 时 mode:"explicit"/ttl:"30m"） | `cacheRetention!=="none"` 且 `promptCacheKeyMode!=="disabled"` | `api/openai-responses.js:91-104,255-265` |
| google-generative-ai | 只读 `cachedContentTokenCount` 进 `usage.cacheRead`；不发显式缓存对象、不发 session 头 | 隐式命中自动 | `api/google-generative-ai.js:168-171` |
| openai-completions(Anthropic-on-OpenRouter) | `cache_control` 走 anthropic 格式（system/最后工具/最后对话消息三处） | `provider==="openrouter"` 且 `model.id` 以 `anthropic/` 开头，或显式 `compat.cacheControlFormat:"anthropic"` | `api/openai-completions.js:1262,784-852` |
| moonshotai / moonshotai-cn | 隐式（服务端自动），`thinking` 用 deepseek 格式（`thinking.type`）或 openai 格式（K3） | 地址含 `api.moonshot.` 或 provider=moonshotai* | `api/openai-completions.js:1228,1276-1289`、`providers/data/moonshotai*.json` |
| zai / zai-coding-cn | 隐式；`thinking:{type:"enabled"|"disabled",clear_thinking:false}` + `reasoning_effort`（GLM5.3 不支持 disabled） | provider=zai* 或地址含 `api.z.ai`/`open.bigmodel.cn` | `api/openai-completions.js:610-619,1223-1228`、`providers/data/zai*.json` |
| qwen-token-plan* | `enable_thinking`/`reasoning_effort`（qwen 格式）；strict 工具可用 | compat 显式 `thinkingFormat:"qwen"` | `providers/data/qwen-token-plan-cn.json`、`api/openai-completions.js:621-629` |
| 自定义 OpenAI 兼容地址（DashScope/其它中转） | **不自动发任何缓存/会话字段**（`prompt_cache_key` auto 只认 api.openai.com）；隐式缓存仍可被服务端命中 | — | `api/openai-completions.js:557-570,1220-1305` |

要点：pi 把所有 `cacheRetention`/`sessionId`/`metadata` 都通过 `SimpleStreamOptions` 透传，`Agent.sessionId` 直接进 `stream()`（pi-agent-core `dist/agent.js:113,143,311`）。**我们自己 streamFn 包装层必须显式传 `sessionId`（建议 `work-<workId>` 或 `sess-<id>`）和 `cacheRetention`**（默认 "short"，长间隔任务可 "long" 但会写 1h/24h 加价写入，Kimi/OpenAI GPT-5.6+ 会真收钱）。

### 2.3 Batch API

| 厂 | 折扣 | 窗口 | 说明 | pi-ai 支持 |
|---|---|---|---|---|
| OpenAI Batch | 50% | 24h | `/v1/batches` JSONL ≤50k 请求；支持 Responses/Chat | 无 |
| Anthropic Message Batches | 50% | 24h | ≤100k 请求或 256MB | 无 |
| Gemini Batch | 50% | 24h | generateContent API；缓存不与 batch 折扣叠加 | 无 |
| DashScope Batch（file） | 50% | 24h–14d | 50k 请求/500MB/单模型一文件；不支持 context caching | 无 |
| DashScope Batch Chat | 50% 限时 | 排队回同一连接 | 长连接排队，最长 1h | 无（但可作为伪同步） |
| Moonshot BatchJob | 60% | completion_window 设定 | ≤100MB JSONL、同模型、命中尽力而为 | 无 |
| GLM/z.ai Batch | 50% | — | 文件提交 | 无 |
| OpenRouter `:batch` | 50% | — | `anthropic/*:batch` 模型 ID | 无 |

证据：developers.openai.com/api/docs/guides/batch、platform.claude.com/docs/en/build-with-claude/batch-processing、ai.google.dev/gemini-api/docs/batch-api、docs.qwencloud.com/developer-guides/text-generation/batch-chat、platform.kimi.ai/docs/pricing/batch、docs.bigmodel.cn/cn/guide/tools/batch、openrouter.ai/docs/features/prompt-caching（Caching in the Batch API 一节）。

pi-ai 侧：`fetchDeferred`/`cancelDeferred`/`deferred` 只在 `providers/faux.js`（假 provider）和 `models.js` 分发层出现；`api/*.js` 无一个真 provider 实现 deferred。批式包装的成本 = 自写「提交 JSONL/轮询/下载结果」~200 行/厂 + 在 `streamFn` 里按 `purpose:"preview"` 分流；**只建议给「全书逐章预览」用**（各章独立、可容忍延迟），写剧本/审稿/演出/画师是串行依赖或需要工具循环，batch 不适用。

### 2.4 结构化输出 / 工具 strict 各家接受的 JSON Schema 子集

| 厂 | 形态 | pi-ai 实现 | 我们 schema 可用子集 |
|---|---|---|---|
| OpenAI strict tools | `tools[].function.strict:true` + 全 required+`additionalProperties:false` | `resolveJsonSchemaStrictSampling`→`makeStrictJsonSchema` 校验并改 schema（可选字段自动变 `anyOf:[原schema,{type:"null"}]`、required 补齐） | 不用 `$ref/$defs/definitions/allOf/oneOf/patternProperties/dependentSchemas/dependencies/unevaluatedProperties/propertyNames/contains/prefixItems/not/if/then/else`；anyOf 只联合标量；根必须 type:object |
| Anthropic strict tools + `output_config.format` | `strict:true` 工具 + 顶层 JSON 输出 | `ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS`（minimum/maximum/exclusiveMinimum/exclusiveMaximum/multipleOf/maxItems/uniqueItems/minContains/maxContains/minProperties/maxProperties、minItems 只允许 0/1、format 白名单）；`strict-tool-limits` 超 20 strict 工具/24 可选参数/16 联合参数按 session 记降级 | 同上 + 无递归 + `additionalProperties:false` 必填 + `required` 必填（可选字段经 `opt()` 展开为 union null 即占「可选参数」名额） |
| Gemini 3+ VALIDATED | `functionDeclarations.parametersJsonSchema` + `toolConfig.mode:"VALIDATED"` | `supportsGoogleStrictToolSampling`（id 含 gemini-3|4+/gemma-4），`rewriteConstAsEnum` 把 string/number const 转单值 enum；Gemini 忽略 `const`/`minLength`/数值边界 | 同上 + `const` 尽量用 `enum` 单值代替 |
| DeepSeek strict | `strict:true` 工具（beta，需 `base_url=.../beta`） | catalog `supportsStrictMode:true`，`detectCompat` 走 `thinkingFormat:"deepseek"` | 同 OpenAI 子集 + `minLength/maxLength/minItems/maxItems` 不支持；`object` 必须全 required |
| Qwen/DashScope | 官方只文档化 `response_format:{type:"json_object"}`；工具调用同 OpenAI 形状 | catalog `supportsStrictMode:true`（token-plan 渠道）；自定义地址 compat 默 false | 保守子集即可 |
| Moonshot Kimi | Chat/Responses 支持 `strict:true`？文档未见；Anthropic 格式顶层 `cache_control` | catalog `supportsStrictMode:false` | 保守子集 |
| GLM z.ai | `response_format` json_object/json_schema；工具同 OpenAI | catalog `supportsStrictMode:true`，`thinkingFormat:"zai"` | 保守子集 |

证据：pi-ai `api/constrained-sampling.js:1-110,190-260`、`api/anthropic-messages.js:1453-1530`、`api/strict-tool-limits.js:1-48`、`api/google-shared.js:340-470`、`providers/data/*.json`；Anthropic 文档 structured-outputs.md（minItems 0/1、no numeric/string constraints、20/24/16 limits）；DeepSeek tool_calls.md（beta strict 子集）；QwenCloud context-cache/structured-output 文档。

我们的模型面 schema 已定只用保守子集（`pi-scaffolding.md` 通用层 2），与三家 strict 兼容面吻合：`opt()`→union null 已占 Anthropic「可选参数」与「联合类型」两个名额，**每个 submit_* 工具的可选+联合字段总数要压到 Anthropic 上限内**（24/16），否则 strict 会被 pi 静默降级。

### 2.5 推理控制映射

| 厂 | 控制字段 | pi-ai `thinkingFormat` / `thinkingLevelMap` | 文件 |
|---|---|---|---|
| OpenAI Responses | `reasoning:{effort,summary}` | `reasoningEffort` 直传 + `include:["reasoning.encrypted_content"]` | `api/openai-responses.js:288-303` |
| OpenAI Completions | `reasoning_effort` | 兜底 `params.reasoning_effort` | `api/openai-completions.js:700-711` |
| Anthropic | `thinking:{type:"enabled",budget_tokens}` 或自适应 `output_config.effort` | `thinkingEnabled`/`thinkingBudgetTokens`/`effort`，`forceAdaptiveThinking` 走 effort | `api/anthropic-messages.js:936-953,1177-1187`；`streamSimple` 映射 reasoning→这些字段 |
| Gemini | `thinkingConfig:{includeThoughts,thinkingLevel/thinkingBudget}` | `usesGoogleThinkingLevel` 判 thinkingLevel vs budget；`getDisabledGoogleThinkingConfig` | `api/google-generative-ai.js:236-315`、`api/google-shared.js:18-77` |
| DeepSeek | `thinking:{type:"enabled"|"disabled"}` + `reasoning_effort` | `thinkingFormat:"deepseek"`，`thinkingLevelMap` 只有 low/high/max | `api/openai-completions.js:657-668` |
| Qwen | `enable_thinking` + `reasoning_effort` | `thinkingFormat:"qwen"`，`enable_thinking=!!reasoningEffort` | `api/openai-completions.js:621-629` |
| GLM z.ai | `thinking:{type,clear_thinking}` + `reasoning_effort` | `thinkingFormat:"zai"` | `api/openai-completions.js:610-619` |
| Kimi K2.x | `thinking:{type:"enabled"|"disabled",keep}` | 归 deepseek 格式（`thinking.type`） | `api/openai-completions.js:657-668`、kimi-chatapi.md:407-412 |
| Kimi K3 | `reasoning_effort:"low"|"high"|"max"`（不可关） | thinkingFormat:"openai"（目录）或 deepseek | `providers/data/moonshotai*.json` |
| OpenRouter | `reasoning:{effort}` | `thinkingFormat:"openrouter"` | `api/openai-completions.js:669-680` |

`streamSimple(model,context,{reasoning:"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"})` 统一映射；Agent 层 `thinkingLevel`（`"off"` 时 reasoning=undefined）透传（pi-agent-core `dist/agent.js:41,310`）。**自定义地址的模型 compat.thinkingFormat 不会被检测，默认 "openai"（只发 `reasoning_effort`）——DeepSeek/Qwen/GLM/Kimi 走中转时 off 会静默失效**；解法二选一：①在我们的 streamFn 包装层按「已知 provider 模板」补 `model.compat`；②高级设置开放一个「推理参数格式」下拉（openai/deepseek/qwen/zai/openrouter），默认 openai。

## 3. 对照现有设计

- **提示顺序「固定块在前、可变块在后」** → `已覆盖`：agent-orchestration.md §3 写手顺序、pi-scaffolding.md 通用层 1「系统提示固定块在前、可变块在后」；本调研给各家最小可缓存阈值（Anthropic 512–4096、OpenAI/DeepSeek/Qwen 1024、Gemini 2048/4096）和 20 块/50 块回看窗提供了数值依据，建议补进 `.workflow/specs/` 角色上下文组装规格。
- **「前缀保持不变，同一卷各章能命中提示缓存」** → `已覆盖`：agent-orchestration.md:77；但缺「同一卷内跨章共享的系统提示+改编设置+骨架切片应保证字节不变」的实现约束，建议写进通用层 1 的角色运行器注释。
- **sessionId / cacheRetention 谁传** → `缺口`：pi-agent-core `Agent.sessionId` 存在但未规定由谁赋值；`cacheRetention` 默认 "short"。建议在通用层 1 角色运行器里固定：`sessionId = work-<workId>-<role>`（让 OpenRouter sticky routing + OpenAI prompt_cache_key 生效），`cacheRetention` 按角色定（写手/美术导演/审稿/画师="short"，全书预览长章批量="long" 仅当用 1h/24h TTL 划算时，Kimi K3 5m 写入免费、Anthropic 5m 1.25×）。补进 `.workflow/research/pi-scaffolding.md` 通用层 1。
- **审核拒绝分类** → `已覆盖`：pi-scaffolding.md 通用层 1；Gemini `SAFETY`/`IMAGE_SAFETY` 映射 error（`api/google-shared.js:440-460`）已进统一分类。
- **用量记账含 cacheRead/cacheWrite** → `已覆盖`：novelive-agent.md:25 字段已含 `cacheRead/cacheWrite`；Anthropic 还有 `cacheWrite1h` 可顺带记。
- **strict schema 子集** → `已覆盖`：pi-scaffolding.md 通用层 2「保守子集」+`strict:"prefer"`；本调研补充 Anthropic「可选参数≤24/联合≤16」的量化上限，建议在该条目加一句「单个 submit_* 的可选+union 字段 ≤16 保险」。
- **Batch API** → `缺口`：docs 未提。全书逐章预览（100 章独立任务）天然适合 24h batch，可省 50%；但实现要在 streamFn 包装层自写 batch 提交/轮询/回放，约 200 行/厂。建议记入 M4「长篇与调度补全」评估项，不做不影响第一版。
- **自定义地址的 compat 缺失** → `缺口`：用户填 DashScope/第三方中转地址时 `thinkingFormat`/`cacheControlFormat`/`sendSessionAffinityHeaders` 全按 "openai" 默认，推理 off 与缓存标记静默失效。建议模型设置里加「兼容预设」下拉（自动检测/openai/deepseek/qwen/zai/openrouter/anthropic-compat），默认自动；检测规则写在通用层 1 的模型配置装载处。
- **DashScope 显式缓存** → `缺口`：pi-ai 不发 `cache_control` 到非 anthropic 地址；DashScope 显式缓存要求 `cache_control:{type:"ephemeral"}` 打在 messages content 块上。若支持 DashScope 显式缓存需在 streamFn 包装层把「前缀边界标记」转成 content 数组+标记。隐式缓存不受影响，第一版可不做显式。
- **成本表** → 见 §5。

## 4. 可拷资产

| 资产 | 位置 | 许可 | 说明 |
|---|---|---|---|
| `makeStrictJsonSchema` + `resolveJsonSchemaStrictSampling` | pi-ai `api/constrained-sampling.js`（MIT，已依赖） | MIT | 直接调用，不拷 |
| Anthropic strict 关键字黑名单 + strict-tool-limits session 记忆 | pi-ai `api/anthropic-messages.js:1453-1481`、`api/strict-tool-limits.js` | MIT | 已内建，不拷 |
| `cache-warming` 决策函数（warm/stop） | pi-ai `cache-warming.js` | MIT | Anthropic 长间隔会话保活可选；我们用不上（制作任务连续），不拷 |
| `detectCompat`/`detectSessionAffinityFormat` 检测表 | pi-ai `api/openai-completions.js:1219-1305`、`api/openai-responses.js:49-52` | MIT | 参照写我们模型配置的「兼容预设」映射 |
| QwenCloud 显式缓存 `cache_control` 写法 | docs.qwencloud.com context-cache | 公开文档 | 支持 DashScope 显式缓存时参考 |
| OpenRouter sticky routing `session_id`/`x-session-id` | openrouter.ai docs | 公开文档 | 我们 Agent.sessionId 直接用 |
| DeepSeek `thinking.type` / Qwen `enable_thinking` / GLM `thinking.type` / Kimi `reasoning_effort` 参数表 | 各厂官方文档 + pi-ai `thinkingFormat` 分支 | MIT/公开 | 自定义地址 compat 预设内容 |

## 5. 需要所有者取舍的事

### 取舍 1：五个模型的「推荐组合」写不写进文档/默认建议

成本表（100 章 / ~30 万汉字，文本调用；图片调用未计；1 汉字≈0.8 token，缓存命中按本报告机制折算）：

| 组合 | 快速 | 主模型 | 写作 | 估算合计（USD） |
|---|---|---|---|---|
| A1 | deepseek-flash（$0.3/$1.2/$0.006） | glm-5.3（$1.4/$4.4/$0.26） | glm-5.3 | **≈ $6.5** |
| A2 | glm-5.3-flash（$0.15/$0.5/$0.03） | deepseek-v4-pro（$1.32/$3.96/$0.044） | deepseek-v4-pro | **≈ $5.2** |
| A3 | qwen3.8-flash（$0.15/$0.47/$0.016） | qwen3.6-plus（$0.5/$3/$0.05+$0.625 写） | qwen3.7-max（$2.5/$7.5/$0.5） | **≈ $5.4** |
| B | deepseek-flash | kimi-k3.1-pro（$2/$10/$0.2+$2 写） | kimi-k3.1-pro | **≈ $11.5** |
| C | claude-haiku-5.5（$0.1/$0.5/$0.01+$0.125 写） | claude-sonnet-5.5（$2/$10/$0.1+$2.5 写） | claude-sonnet-5.5 | **≈ $11.2** |
| D | gemini-3.1-flash-lite（$0.25/$1.5/$0.025） | gemini-3.1-pro-preview（$2/$12/$0.2） | gemini-3.1-pro | **≈ $12.5** |
| E | gpt-5.4-mini（$0.75/$4.5/$0.075） | gpt-5.2（$1.75/$14/$0.175） | gpt-5.2 | **≈ $13.6** |

口径：预览快速模型一次读 30 万字；写手每章 3k 汉字原文 + ~12k 汉字稳定前缀（缓存读）；审稿/美术导演各每章 ~6k 汉字新输入 + ~15k 缓存前缀 + 少量输出；综合/画师少量。Anthropic 按 5m 写 1.25×+读 0.1×；Qwen/Kimi 按显式 5m 写/隐式读；OpenAI/Gemini 隐式缓存读价；DeepSeek/GLM 隐式命中价。实际量随提示词长度浮动 ±50%。

**建议**：文档只给「示例组合」（不绑定），A1/A2/A3 任一作国产低成本推荐、C 作质量档推荐；不写死默认，所有者在 M1b 用测试用书实测后定开发期推荐。

### 取舍 2：要不要支持 DashScope/自定义地址的「显式缓存标记 + thinkingFormat 预设」

选项：①不做——隐式缓存仍工作，成本略高（Qwen 隐式读 20% vs 显式 10%+写 125%）；②在模型设置加「兼容预设」下拉并把 `compat.thinkingFormat`/`cacheControlFormat` 写到 pi Model.compat（约 80 行映射 + 文档一行）；③在 streamFn 包装层把「稳定前缀边界」翻译成 DashScope `cache_control` content 数组（多 ~100 行）。

**建议**：做 ②（Kimi/GLM/DeepSeek 自定义地址的推理 off 与 Anthropic-format 显式缓存都受益），③留 M4 评估。

### 取舍 3：全书逐章预览是否走 Batch API

收益：50% 折扣（DeepSeek 预览 $0.11→$0.05；GPT-5.2 档预览 $0.31→$0.15；绝对值小）。代价：自写 batch 提交/轮询/结果回放 ~200 行/厂，且 pi-ai 无 hook，要在我们的调用层分流「preview 用途走 batch」；24h 窗口对「第一卷预览完就开始制作」不友好（预览是启动路径）。

**建议**：第一版不做；记入 M4 评估项（`docs/creation-pipeline.md` §6 或 `.workflow/specs/m4-*`），届时若用户反馈「整书预览慢且贵」再实现，只给预览阶段用。

### 取舍 4：`cacheRetention`/`sessionId` 的策略写进哪

- `sessionId`：建议 `work-<workId>-<role>`（同角色跨章同 key，OpenRouter/OpenAI 粘路由命中同一 provider/缓存池）；对话面板 `session-<conversationId>`。
- `cacheRetention`：默认 "short"；写手/美术导演/审稿等连续制作角色保持 "short"；**对话面板空闲>5min 会重写缓存**，若用户模型是 Anthropic 且想省 1h 写费，可在面板会话激活时切 "long"——但 1h 写 2×、GPT-5.6 12h 写 2.5×，只有间隔命中次数≥3 才回本，不建议默认开；写成「高级设置可选 cacheRetention」。

**建议**：写进 `.workflow/research/pi-scaffolding.md` 通用层 1 角色运行器条目（`sessionId=work-<id>-<role>`、`cacheRetention:"short"` 默认、不暴露调优 UI）。

### 取舍 5：Anthropic 格式作为第三接口格式的 compat 预设

「Anthropic Messages」格式下用户填 Moonshot `/anthropic` 或中转时，`supportsMessageThreads` 默认 false（只 api.anthropic.com true）正确；但 `cacheControlFormat` 只在 openrouter+`anthropic/` 模型名检测，Moonshot Anthropic 端点发 anthropic `cache_control` 是否被理解未经证实。建议：Anthropic 格式的「兼容预设」只放 `supportsStrictTools`/`supportsLongCacheRetention`/`supportsMidConvoSystemMessages` 等保守默认，文档写明「非官方端点行为以实测为准」。

## 附：pi-ai dist 复核命令与文件

```
npm pack @earendil-works/pi-ai@1.6.0 && tar xzf …/package/dist
```
关键文件：`api/anthropic-messages.js`（28-45 缓存、1076-1155 参数组装、1407-1427 消息断点、1453-1530 strict）、`api/openai-completions.js`（143-190、516-535 会话头、550-720 参数、784-852 anthropic 缓存复用、1161-1184 usage、1219-1345 detectCompat）、`api/openai-responses.js`（49-104、255-330 参数）、`api/constrained-sampling.js`（1-110 严格子集、190-260 strict 决策）、`api/google-generative-ai.js`（168-171 缓存读、236-315 参数）、`api/google-shared.js`（18-77 thinking、340-470 strict）、`api/strict-tool-limits.js`、`api/openai-prompt-cache.js`、`api/simple-options.js`（buildBaseOptions 透传）、`providers/data/*.json`（模型目录/价格/compat）。
pi-agent-core：`dist/agent.js:41,113,143,310`（thinkingLevel/sessionId 透传）、`dist/agent-loop.js:265-283`（streamFn 入参）。