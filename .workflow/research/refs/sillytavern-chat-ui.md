# 研究报告

## A) SillyTavern 提示工程机制（`public/scripts/…`，release 分支）

### A1. Chat Completion 预设（`public/scripts/openai.js`、`public/scripts/PromptManager.js`）

**数据结构** — 预设 JSON 就是 `oai_settings` 的全量导出（`default_settings`，openai.js:425-509）。和提示词相关的字段：

- `prompts`（→ `openai_setting_names` 映射 openai.js:377）：`Prompt[]` 数组。`Prompt` 类字段（PromptManager.js:80-200）：`identifier`（语义锚点）、`role`（system/user/assistant）、`content`、`name`、`system_prompt`（是否参与 system 区排序）、`marker`（占位符，内容由系统注入：chatHistory/dialogueExamples/worldInfoBefore/After 等）、`injection_position`（`INJECTION_POSITION`：`0=RELATIVE` 按序插在 prompt_order 处、`1=ABSOLUTE` 以深度注入聊天）、`injection_depth`、`injection_order`（同深度内的优先级）、`forbid_overrides`（阻止角色卡覆盖 main/jailbreak）、`extension`、`injection_trigger`（按生成类型触发）。
- `prompt_order`：`[{character_id, order: [{identifier, enabled}…]}]`，按角色维度存的排序表（PromptManager.js:1206-1248；默认顺序 promptManagerDefaultPromptOrder，PromptManager.js:2053-2082：`main → worldInfoBefore → personaDescription → charDescription → charPersonality → scenario → enhanceDefinitions → nsfw → worldInfoAfter → dialogueExamples → chatHistory → jailbreak`）。
- 采样与格式字段：`wi_format`/`scenario_format`/`personality_format`（`{0}`/`{{macro}}` 包装模板）、`squash_system_messages`（把连续 system 合并成一条）、`custom_prompt_post_processing`（NONE/MERGE/STRICT/SEMI…，openai.js:153-166）、`assistant_prefill`、`continue_prefill`、`names_behavior`、工具调用开关 `function_calling`、`tool_call_recurse_limit`、reasoning effort、`seed` 等。

**组装管线**（`populateChatCompletion`，openai.js:1190-1330）：
1. 固定先放 `worldInfoBefore → main → worldInfoAfter → charDescription → charPersonality → scenario → personaDescription`（marker 占位，靠 `prompt_order` 决定相对位置）；
2. `controlPrompts`（impersonate/quietPrompt/continuePrefill）永远钉在最后；
3. `nsfw`、`jailbreak` 硬编码在 `systemPrompts` 列表里，走 `addToChatCompletion`；其余 `system_prompt=false` 的用户自定义 prompt 按 `prompt_order` 排入；
4. `summary`、`authorsNote`、`vectorsMemory`、`vectorsDataBank`、`smartContext` 这类 extension prompt（`IN_PROMPT` 相对位置）通过 `injectToMain` 插到 `main` 的前后；
5. `injection_position=ABSOLUTE` 的 prompt 经 `populationInjectionPrompts`（openai.js:810-870）从聊天末尾往回数 `injection_depth`，同深度内先按 `injection_order` 降序、再按角色 system→user→assistant 分组、`\n` 拼接成一条消息插进去；
6. token 预算由 `ChatCompletion.setTokenBudget` 管理，`reserveBudget` 先扣回复/控制/工具 schema 的额度，聊天历史 `populateChatHistory` 吃剩余预算（超预算丢 `TokenBudgetExceededError`）。

**对「main/jailbreak 可覆盖」的约定**：角色卡里的 `system_prompt`/`post_history_instructions` 会替换同名 prompt，除非 `forbid_overrides`（openai.js:1527-1552）。

### A2. Instruct / Context 模板（`public/scripts/power-user.js`）

- `power_user.instruct`（power-user.js:218-245）：`input_sequence`/`input_suffix`/`output_sequence`/`output_suffix`/`system_sequence`/`system_suffix`/`last_system_sequence`/`first_input_sequence`/`first_output_sequence`/`last_input_sequence`/`last_output_sequence`/`story_string_prefix`/`story_string_suffix`/`stop_sequence`/`wrap`/`macro`/`names_behavior`/`activation_regex`/`bind_to_context`/`user_alignment_message`/`system_same_as_user`/`sequences_as_stop_strings`。本质是「不同角色消息包不同序列符」+「首/尾消息可用不同序列」。
- `power_user.context`（power-user.js:247-256）：`story_string` 是 **Handlebars 模板**（`{{description}} {{personality}} {{persona}} {{scenario}} {{wiBefore}} {{wiAfter}} {{trim}}`；默认串见 power-user.js:90），`chat_start`、`example_separator`、`story_string_position`（IN_PROMPT/IN_CHAT）+ `story_string_role`/`story_string_depth`。`validateStoryString`（power-user.js:2280-2313）会对「有内容但模板没用到的字段」弹警告——值得抄。
- `bind_to_context`：context 模板和 instruct 预设同名绑定切换（power-user.js:2070-2078）。`instruct_derived`/`model_templates_mappings` 可按模型/模板哈希自动选预设。

### A3. Regex 扩展（`public/scripts/extensions/regex/engine.js`、`index.js`）

**脚本 JSON 格式**（index.js:828-868 保存逻辑；单文件导出为 `regex-<name>.json`）：
```jsonc
{
  "id": "uuid",
  "scriptName": "…",
  "findRegex": "/pattern/gis",          // JS 正则字面量字符串
  "replaceString": "$1 $<name> {{match}}", // $1..$n、$<named>、{{match}}=$0
  "trimStrings": ["…"],                  // 从每个捕获组中按字面值剔除的串（可含宏）
  "placement": [1,2,5,6],                // regex_placement 枚举数组
  "disabled": false,
  "markdownOnly": false,                 // 只作用于 markdown 渲染
  "promptOnly": false,                   // 只作用于 prompt 提交
  "runOnEdit": true,                     // 用户编辑消息后是否重跑
  "substituteRegex": 0,                  // 0=NONE 1=RAW(宏替换) 2=ESCAPED(宏值转义)
  "minDepth": null, "maxDepth": null     // 作用的消息深度区间
}
```
**`regex_placement`**（engine.js:281-293）：`MD_DISPLAY=0(废弃) USER_INPUT=1 AI_OUTPUT=2 SLASH_COMMAND=3 WORLD_INFO=5 REASONING=6`。

**执行模型**（`getRegexedString`/`runRegexScript`，engine.js:329-445）：调用方传 `{isMarkdown,isPrompt,isEdit,depth}`；三个「only」开关按 truthy 组合决定作用域（既不勾=仅普通路径）；`minDepth/maxDepth` 按聊天深度过滤；`findRegex` 先过 `substituteParamsExtended` 宏替换（RAW/ESCAPED 模式）；`replaceString` 内 `$1`/`$<name>` 会先把 `trimStrings` 从捕获组里清掉再插值，最后再过 `substituteParams` 宏。脚本有三种作用域：global、preset（绑定预设名）、scoped（绑定角色卡）。

### A4. Reasoning 格式化（`public/scripts/reasoning.js`）

- 模板 = `{prefix, suffix, separator}`（用户可配，如 `<think>`/`</think>`/`\n\n`）。`parseReasoningFromString`（reasoning.js:1459-1490）用 `^\s*prefix(.*?)suffix` 的正则把开头（strict 时必须在开头）thinking 块剥离成 `message.extra.reasoning`；`formatReasoning` 是逆变换。
- 解析出的 reasoning 会再过一遍 `regex_placement.REASONING` 的 regex 脚本（reasoning.js:1542-1548）。
- 历史消息里的 reasoning 保存为 `extra.reasoning` + `reasoning_duration` + `reasoning_type` + `reasoning_signature`（签名块用于 Claude 带回，openai.js:644 的 `signature` 字段）。

### A5. Author's Note（`public/scripts/authors-note.js`）

`chat_metadata` 存 per-chat：`note_prompt / note_interval / note_depth / note_position / note_role`。默认值在 `extension_settings.note.{default,defaultDepth=4,defaultInterval=1,defaultPosition=1,defaultRole=system}`（authors-note.js:275-303）。

关键机制（`setFloatingPrompt`，authors-note.js:331-372）：
- `interval`：每 N 条**用户消息**注入一次（`lastMessageNumber % interval`）；interval=1 永远注入；
- `position`：0=在 scenario 后、1=在聊天中（IN_CHAT，用 `depth`）、2=scenario 前；
- `role`：system/user/assistant；
- 经 `setExtensionPrompt('2_floating_prompt', …)` 注册成 extension prompt，注入时由 `populationInjectionPrompts` 按 depth 插入；
- `allowWIScan`：AN 文本也会喂给 World Info 关键词扫描；
- 角色级 `extension_settings.note.chara`（replace/before/after 三种合并策略）。

### A6. World Info / Lorebook（`public/scripts/world-info.js`）

**Book 文件** `{entries: {uid: entry}}`。条目字段全量在 `newWorldInfoEntryDefinition`（world-info.js:4079-4123）：
`key[]`/`keysecondary[]`、`comment`、`content`、`constant`（绿球，总是激活）、`vectorized`、`selective`+`selectiveLogic`（AND_ANY/NOT_ALL/NOT_ANY/AND_ALL）、`order`（预算裁剪优先级，默认100）、`position`（`world_info_position`：0=before 1=after 2=ANTop 3=ANBottom 4=atDepth 5=EMTop 6=EMBottom 7=outlet）、`depth`（atDepth 用，默认4）、`outletName`、`role`、`group`/`groupWeight`/`groupOverride`、`probability`/`useProbability`、`scanDepth`（覆写全局扫描深度）、`caseSensitive`/`matchWholeWords`/`useGroupScoring`（null=用全局）、`excludeRecursion`/`preventRecursion`/`delayUntilRecursion`、`sticky`/`cooldown`/`delay`（时效）、`characterFilterNames/Tags/Exclude`、`triggers`（生成类型）、`automationId`、decorators（`@@activate`/`@@dont_activate` 写在 content 开头的行内指令，world-info.js:4644-4690）。

**激活流程**（`checkWorldInfo`→`getWorldInfoPrompt`，world-info.js:886-920 起；WorldInfoBuffer world-info.js:205-410）：
- 聊天历史按「从最新往回数 N 层」切成 depth buffer（全局 `world_info_depth`，条目可 `scanDepth` 覆写），拼接成扫描文本；
- `key` 命中（大小写/整词由全局或条目覆写）；selective 条目要求 `keysecondary` 按 `selectiveLogic` 也命中；
- 可扫描**非聊天**来源（persona/character description/personality/depth prompt/scenario/creatorNotes，逐条开关）；
- **递归**：激活条目的 `content` 会被加进扫描 buffer（`world_info_recursive`，`world_info_max_recursion_steps` 限步数），条目可 `excludeRecursion`（不让自己被递归触发）/`preventRecursion`（内容不进 buffer）/`delayUntilRecursion`；
- `constant` 总是命中；`probability`+`useProbability` 概率命中；`sticky/cooldown/delay` 按时效控制；
- **预算**：激活条目按 `order` 降序、`position` 分桶，直到 `world_info_budget`（占上下文百分比）或 `world_info_budget_cap`（绝对 token 上限），`ignoreBudget` 跳过；
- `min_activations`：不足数量则自动加深扫描（skew，`min_activations_depth_max` 封顶）；
- 结果分流：before/after 拼进系统区，atDepth 走 `populationInjectionPrompts` 按 depth+role 注入，ANTop/ANBottom 相对 Author's Note 定位，EMTop/EMBottom 相对对话样例定位，outlet 按名字分流给扩展。

---

## B) React 聊天前端组件调研

| 库 | 授权/体量 | 传输适配 | 样式灵活度 | 对 Novelive 的匹配 |
|---|---|---|---|---|
| **assistant-ui** (`@assistant-ui/react`) | MIT，活跃（Vercel 之外最主流的 headless chat 库），3M+/周下载 | `useLocalRuntime` 需实现 `ChatModelAdapter.run`（可返回 AsyncGenerator）——完全进程内、天然适配 MessagePort/自研事件流；`useExternalStoreRuntime` 让你自带 store，threadList/branching 都支持（`messageRepository` + `headId/parentId`） | Primitives 全 unstyled/headless，提供 classNames/slots，CSS Modules 完全可用；预制 styled 层才碰 Tailwind | ✅ 几乎逐条命中需求：Reasoning 组件（可折叠 thinking）、Tool UI（`ToolFallback`/自定义工具卡，args+result 全量）、BranchPicker、ThreadList（会话列表）、Composer；streaming 由 adapter 你控 |
| **Vercel AI Elements** | MIT | 强绑 AI SDK `UIMessage`/`useChat` 数据协议（HTTP stream）；想用自定义事件流得自己翻译 | 源码拷贝式组件但前提 **Next.js + Tailwind + shadcn**；与「CSS Modules + design tokens」冲突；且官方宣布 2026-11 底并入 shadcn/ui、项目将弃用 | ❌ 不适合 |
| **streamdown** (Vercel) | Apache-2.0（GitHub README）/npm 标注 Other | 纯渲染组件，传字符串即可——与传输无关 | `data-streamdown` 属性选择器 + CSS 变量，无需 Tailwind | ✅ 流式 markdown 核心：remend 修补未闭合语法、GFM+KaTeX+Mermaid+Shiki、按块 memo；可独立用 |
| **react-markdown + remark/rehype 自攒** | MIT | 同上传入字符串 | 完全自己控 | 能跑但要自己处理「未闭合 `**`/` ``` `」闪动、按块 memo、代码高亮增量；streamdown 就是为解决这件事 |
| **@llm-ui/react** | MIT | 自带 `useLLMOutput`（传流式字符串），主打「自定义 block」渲染（如把非 markdown 片段切成 React 组件） | 无样式包袱，全自渲染 | 🟡 备选：若剧本输出含自定义标签/结构化块（场景卡、镜头标记），llm-ui 的 block 机制比 remark 插件更易控；但维护体量远小于前两者 |
| **ai-markdown (ai-markdown/ai-markdown)** | MIT，较新 | 增量 markdown 引擎，React/Vue 绑定，GFM+LaTeX+CJK | 无样式依赖 | 🟡 增量解析性能优于 streamdown 的全串重解析，但生态/工具链远弱，风险高 |
| **TanStack Markdown / p-vbordei/markdown-streaming** 等 | MIT | 新兴/个人项目 | — | ❌ 维护风险 |

**传输适配结论**：assistant-ui 的所有 runtime 都是「adapter 模式」，不是 HTTP 客户端。Electron 里 utility process ↔ renderer 走 `MessagePort`，你在 `ChatModelAdapter.run` 里把 port 事件流转成 `AsyncGenerator<ChatModelRunResult>`（text-delta/reasoning-delta/tool-call/result/finish），或干脆 `ExternalStoreRuntime`：后端进程直接把完整消息树推给你，你 `setMessages` 即可——后者还能把 branching 的 `headId/parentId` 数据结构直接落在你的 DB 层。

---

## 对 Novelive 的启示

1. **抄 Prompt 的「identifier + marker + injection_position/depth/order」三元模型**（PromptManager.js:80-200）：写作用的「风格 preset」直接建模成 `{identifier, content, role, system_prompt, marker, injection_position(RELATIVE/ABSOLUTE), injection_depth, injection_order, forbid_overrides, injection_trigger}`。ABSOLUTE=「在章节历史倒数 N 层注入导演批注/场景批注」，正好覆盖改编工作流中「提醒最近场景走向」的需求。
2. **prompt_order 按「角色」分桶存**（`[{character_id, order:[{identifier,enabled}]}]`）：Novelive 可以换成按「project/volume/writing-model 档位」分桶，同一 preset 在不同卷里开关不同条目——剧本预设和角色卡不同，**多个排序表共存**这个设计值得保留。
3. **Regex 引擎整套照抄**（engine.js:281-460）：`placement`（写作模型里对应 USER_INPUT=预处理正文、AI_OUTPUT=清洗模型腔/格式漂移、WORLD_INFO=改 lorebook 条目、REASONING=清 thinking）+ `markdownOnly/promptOnly/runOnEdit` + `minDepth/maxDepth` + `trimStrings` + `substituteRegex` 宏替换。特别地，`$1`/`$<name>` 反向引用 + `{{match}}` 语法简单可直接沿用，读者从 SillyTavern 生态导入脚本是零成本。
4. **context 模板用 Handlebars + 字段校验警告**（power-user.js:2280-2313）：`validateStoryString` 的「模板没用到但有内容」警告对长文工程非常关键（章节摘要、卷级 lorebook 很容易漏字段），抄。
5. **Author's Note 的 interval+depth+position+role 四元组**（authors-note.js:331-372）正是「每 N 章重述全局基调 / 当前卷冲突」的机制，加上 `allowWIScan`（AN 文本反过来触发 lorebook）这个双向钩子，改编 agent 会频繁用到。
6. **World Info 要抄的不是关键词命中，而是「多位置 + 预算裁剪 + 递归 + sticky/cooldown/delay」**：`world_info_position` 七桶（before/after/AN 前后/atDepth/EM 前后/outlet）直接对应「卷级 lorebook 进系统区、场景级条目按 depth 注入、人物备忘跟随 AN」；`order` 作预算裁剪优先级、`ignoreBudget`、`scanDepth` 条目覆写、`excludeRecursion/preventRecursion/delayUntilRecursion` 三件套抑制递归爆点。
7. **前端选 assistant-ui + streamdown，别用 AI Elements**：前者 MIT + headless primitives + adapter runtime（MessagePort 友好、branching 由你 store 控）、Reasoning/ToolFallback/BranchPicker/ThreadList 一应俱全；streamdown 解决流式 markdown 的未闭合语法和按块 memo，可全 CSS 变量/选择器定制，不引入 Tailwind。AI Elements 强绑 AI SDK UIMessage + Tailwind/shadcn 且官方已宣布弃用，react-markdown 自攒则要把 streamdown 已解决的问题重做一遍。
8. **避免**：ST 的 jQuery 全局状态/`extension_settings` 单例/`chat_metadata` 魔法 key、依赖角色卡 ID 的 prompt_order 在 Novelive 这种「多卷+多角色档位」下会腐化——换成显式 preset 对象+注入点声明；`oai_settings` 一把抓 100+ 字段导致 preset JSON 读写互相踩踏，Novelive 应拆 preset 文档（prompt 列表、采样、regex 绑定、world-info 绑定分文件）。
9. **Reasoning 作为 first-class message part 存 `{reasoning, duration, type, signature}`**（reasoning.js:1532-1550 + openai.js:644）：写作模型的 thinking 要随消息持久化、能过 regex、能回灌 Claude 签名，不要只当成「展示用前缀」。
10. **[推测]** ST 的「preset 全量导出 + 三作用域 regex（global/preset/char）」组合，在 Novelive 应演进成「写作 preset 绑定 regex preset + 卷级 regex override」，否则百章规模下脚本会失控地堆在 global 层。

**Files**（关键锚点）：`public/scripts/PromptManager.js:80-200,2000-2082`（Prompt/默认值）、`public/scripts/openai.js:425-509,810-870,1190-1620`（设置字段+注入+组装）、`public/scripts/extensions/regex/engine.js:281-460`、`index.js:828-868`（regex 引擎+JSON）、`public/scripts/power-user.js:90,215-256,2280-2313`（instruct/context）、`public/scripts/reasoning.js:1440-1560`、`public/scripts/authors-note.js:20-110,275-372`、`public/scripts/world-info.js:855-870,4079-4123,4644-4690`（WI 位置+schema+decorators）。