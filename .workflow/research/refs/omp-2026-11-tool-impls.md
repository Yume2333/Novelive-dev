# omp 工具实现逐项盘点(coding-agent)

来源:`/tmp/omp-src/packages/coding-agent/src/tools/*`、`src/prompts/tools/*.md`、`src/edit/*`、`src/task/*`、引擎本体在 `crates/edit`(Rust napi)。逐项给:schema / 描述怎么写 / 错误怎么回模型 / 结果怎么截断 / 并发与审批标记 / 要剥的依赖 / 判定与落点。判定沿用 直接拷贝/移植改写/只参考/不要。

## 0. 公共底座(各工具共用,先拿)

- `tool-errors.ts` ~68 行:`ToolError`(render→model message)、`ToolAbortError("Operation aborted")`、`throwIfAborted`、`renderError(e)`。**直接拷贝**,纯 TS。落 `agent/tools/errors.ts`。
- `tool-result.ts` ~115 行:`toolResult(details).text().error().useless().truncation().done()` builder;`meta.truncation` 驱动「N 行省略」提示。**直接拷贝**其形状。
- 截断助手 `pi-tui/tools/streaming-output.ts`:`DEFAULT_MAX_LINES=3000`、`DEFAULT_MAX_BYTES=50KiB`、`DEFAULT_MAX_COLUMN=512B/行`;`truncateHead` 整行头截、绝不出半行,`firstLineExceedsLimit` 单独标记;`truncateHeadBytes` 给字节级兜底预览;`truncateLine` 列截断打 `…`。**直接拷贝**(~150 行纯 TS,`Buffer.byteLength` 计字节)。所有 `read_*` 输出走它。
- `applyListLimit`(list-limit.ts):`{limit→{reached, suggestion: reached*2}}`「建议翻倍」约定,几行。**直接拷贝**。
- 错误语气总则:短、可照做、指名修复法(`"scope with \`glob\` first"`、`"not proof of absence"`),非法输入回合法写法+一个例子。这条是 pi-scaffolding 已定的,omp 全库一致执行。

## 1. read(3690 行)+ read-format/read-selector/racy-stamp/write(1267)

- **schema**:`{path:string}` 单参数,行选区全部内联在 path 后缀(`read.ts:902`)。描述第一句明令「Put line ranges in `path`, never a separate range/offset/limit parameter」——`read_scene`/`read_scenes` 照抄这个形状,选区进 `sceneId`/路径串即可。
- **选区语法**(read-selector.ts ~136 行,纯 TS):`:N`、`:N-M`、`:N+K`、`:N-`、`:-N`尾、逗号表 `:5-16,19`、`:raw`、复合 `:raw:N-M`;`:-N` 先存 `{kind:'tail'}`,拿到行数后 `resolveTailSelector` 钉死。非法输入报错列全部合法语法。**直接拷贝**(删 `:img`/`:conflicts`/sqlite 支)。落 `tools/lib/selectors.ts`。
- **hashline 头与前缀**:`[path#TAG]`(read-format.ts:71;相对 cwd 的路径,不压成 basename——注释里写明 basename 会撞同名文件),每结果只加一个头;每行源文前缀 `N:`(hashline 模式)/`N|`(纯行号)/无前缀(raw)。省略行是裸 `…`(BRACKET_CONTEXT_ELLIPSIS)。摘要尾部:`[…Nln elided; re-read needed ranges with path:r1-r2,r3-r4]`。
- **单范围上下文**:非 raw 单区间自动外扩前 1 行+后 3 行(RANGE_LEADING/TRAILING_CONTEXT_LINES,read-format.ts:288);多区间和 raw 不扩。
- **截断通知原句**(直接抄):`[Showing lines A-B of T. Use :N- to continue]`、`[R more lines in X. Use :N- to continue]`、`[Range A-B stopped before line N at the 50KB read budget. Use base:rest to continue]`、`Line N is beyond end of X (T lines total). Use :1- to read from the start, or :T to read the last line.`、`[Cannot read binary file 'p' (size); not valid UTF-8 text. Use ':raw'…]`。通知**追加在截断后的文本尾部**且参与 details,不会被截掉。
- **stale/racy**:read 自身不查 mtime;新鲜度靠 EditStore 快照——读时记录全文的 content-hash tag,edit 时校验。`racy-stamp.ts` 只有 `RACY_STAMP_WINDOW_MS=2000`(git racy-clean:2 秒内的新 stat 不缓存),给 grep/archive 缓存用,与 read 无关。
- **seen-lines 取证**:read 把「模型实际看到的行号」记进快照(`recordSeenLinesFromBody`,edit/store.ts:30-50);列截断的行记 `NO_FULL_LINE=0`——有取证但不算看全。edit 默认 `enforceSeenLines` 拒锚到没见过的行。**这个机制是 hashline 的一半价值,移植必须带上**。
- **write**:`{path,content}`(content 必填——strict provider 把 optional 变 nullable,模型会送 null,write.ts:222);先 `unwrapHashlineHeaderPath` 剥 `[path#TAG]` 再派路;`stripWriteContent`(write-content.ts:114)把模型粘贴回来的 `N:`/`N|`/`>>N:` 前缀和头行剥掉,`prefixesEvidenced` 要求 ≥2 个编号行与快照同行内容匹配或有头行才剥——防误剥本来就带数字前缀的正文;成功回 `Successfully wrote N bytes to P` + 新 `[path#TAG]` 头(seen 集为空=不受限);附注 `Note: auto-stripped hashline display prefixes…`、`Note: kept the replaced file's CRLF line endings and UTF-8 BOM.`;还有「拒绝用截断投影覆盖整文件」守卫(`Refusing to overwrite…incomplete read projection…Re-read the omitted ranges`)。**strip/evidence 逻辑直接抄进 `apply_staging_patch` 输入清洗**——模型把 `read_scene` 编号输出原样糊回 patch 时不会毁掉文件。
- **并发**:read 无 concurrency=shared(并行安全),但执行前 `await earlierEffectsSettled`——同批 write 先落盘再读(read.ts:2063),零延迟防批内竞态,**这个等前一招值得抄**;write `concurrency:"exclusive"`。file-mutation-queue.ts(~60 行,按 realpath 串行化扩展工具写)内建工具不走,但场景并发写可以借。
- **依赖**:read.ts 里 `Bun.file().text()/.stat()`、`Bun.hash.wyhash` → `fs`/`crypto`  trivial;write.ts `bun:sqlite` 硬依赖(只服务 sqlite 行写,删);napi:`EditStore`、`summarizeCodeAsync`(tree-sitter 摘要)、`notebookToEditableText`、`hashline*`、`peekFile`。**判定:read-selector/racy-stamp/write-content 直接拷贝;read-format 的 in-memory 分页渲染+通知串移植改写;read.ts 本体与 read-summary(tree-sitter elision)不要/只参考。**

## 2. edit / hashline(引擎在 Rust:crates/edit 27748 行;TS 侧 edit/index.ts 877 + schemas 51 + store 50 + auto-repair 432 + hashline-compact.md)

- **schema**:`{input:string}` 一个字段装整条 patch(schemas.ts:39-44);edit 工具还有 replace/patch/apply_patch/sloppy 四模式,`edit.mode` 默认 hashline。
- **描述**:`crates/edit/prompts/hashline.md`(31 行全量版)+ `edit/hashline-compact.md`(24 行紧凑版,给 editPromptVariant=compact 的模型)。两份都值得**直接抄改**——紧凑版已经是极限压缩的完整语法卡(`PUT N.=M:`/`PUT <N:`/`PUT >N:`/`PUT >$:`/`CUT`/`@name`/`REM`/`MV` + 五条铁律 + 一个例子)。我们给 `.nvs` 改写工具的版本把「syntax block」「decorator」换成 .nvs 语义(scene 头、`@`指令行、`choice` 块)即可。
- **wire 语法**(tokenizer.rs):节 `[PATH#TAG]`,op 头 `PUT N.=M:`(inclusive 替换,`+`体)、`PUT N*:`(语法块)、`PUT <N:`/`PUT >N:`/`PUT >$:`(插)、`PUT >N*:`(块后同级插)、`CUT N.=M`/`CUT N*`(删并入寄存器,可 `@name`)、`PUT <N @name` 等粘贴、`REM` 删文件、`MV DEST` 改名;可选 `*** Begin/End Patch` 信封。体行 `+TEXT`,孤 `+`=空行,字面 `-`/`+` 开头写 `+-`/`++`。**寄存器(剪贴板)可整段砍掉**——`.nvs` 场景间搬台词用不上跨文件剪贴板。
- **op→低层 edit 的降维**(apply.rs):`PUT N.=M:` = 每行体一个 `Insert{BeforeAnchor(N),replacement:true}` + N..M 每行一个 `Delete`;插 = `Insert{Before/AfterAnchor}`;渲染按 anchor 排序后单趟扫:每个被锚行 = before + replacements + 原文(没删的话) + after。BOF/EOF 单列。phantom line:尾换行留下的空行可被 range 尾吃、不可作 replace 起点。100% 可移植,无黑魔法。
- **校验链**:parse(合法 op/信封/范围正序/不重叠/放大上限 10 万行)→ 快照 tag 匹配 → seen-lines → bounds → apply → echo/歧义/语法复检(tree-sitter,我们删)→ no_change 拒绝(第三节连中即 error)。错误 kinds:`missing_tag/stale_tag/unknown_tag/other_file_tag/unseen_lines/out_of_range/ambiguous_boundary/no_change/parse/file_not_found` 等,每个错误带「当前真 tag + 怎么补救」。
- **stale 检测与恢复**(store.rs + recovery.rs):tag 匹配旧快照但磁盘已变 → 有链上快照时 diff 新旧文本建 prev→cur 行号映射,能唯一重映射锚点就恢复并带 warning,否则拒绝回当前 tag。**最小移植只做拒绝(回真 tag 叫模型重读)就够**——`.nvs` 场景文件小,重读成本低,recovery 那 562 行可以不要。
- **冲突检测**:conflict-detect.ts(937 行)是**另一回事**——扫 `<<<<<<<`/`=======`/`>>>>>>>` merge marker,注册冲突块,模型用 `conflict://<id>` URL 写回解决。与 hashline 的「多 op 冲突」(重叠 range 拒、同 range 重复 replace 合并 warning)无关。**对我们:只参考;`.nvs` 由应用独占写,不会出现 merge marker。**
- **TS 侧壳**(edit/index.ts):流式预览(EditSession.push→预览 diff)、LSP writethrough、自动生成文件守卫、plan-mode 守卫、`MAX_EDIT_SNAPSHOT_TEXT_CHARS=32768` 详情快照上限。大多 omp 专属;要拿的是「成功回 `[path#新TAG]` + 可选 preview + `Warnings:` 块」的结果格式。
- **依赖**:引擎整体是 napi——**Node 24 直接用不了,只能重写**。好消息:核心子集(节解析+op 降维+apply+tag 校验+seen-lines)约等于 `tokenizer 614+parser 872 中的 op 部分+apply 的 render/validate ~300+store 的 hash/快照 ~200`,**JS 重写 ~400-600 行**;删掉块 op(tree-sitter)、剪贴板寄存器、语法复检、流式、recovery。
- **判定:移植改写**。原型已验证可行(见 §11)。落 `agent/tools/hashline.ts` + `apply_staging_patch`/场景改写工具内。

## 3. todo(743 行)+ todo.md

- **schema**:op-union 单调用 `{op:'init|start|done|rm|drop|append|view', list?:[{phase,items[]}], task?:string|string[](verbatim 内容不是 id), phase?, items?}`(todo.ts:46-66)。
- **描述(todo.md 要点,抄)**:「`todo` NEVER takes a turn of its own: emit it in the same response as your next real tool call」「Tasks identified by verbatim content, NEVER generated IDs」「init for 3+ steps…MUST list EVERY user item separately」。
- **错误**:错误收进 `errors[]`,任一条失败整批丢弃,汇总 `Errors: a; b` + `isError`;`task-\d+` 触发教练句 `"Tasks are referenced by content, not by IDs — pass the task's full text"`;`lenientArgValidation` 缺 op 时按形状推断(list→init)。
- **结果**:`formatSummary` 每次重渲剩余项 `Overall: N/M done`+`Active phase i/j`+`[X]/[ ]` 表;状态进 session 条目,压缩后重建。
- **并发**:`exclusive`,`approval="read"` 自动批。
- **依赖**:纯 TS(omptype 换 pi-schema)。**判定:移植改写 → `propose_plan`/主控的计划工具**;verbatim 寻址、单 in-progress 不变量+自动推进、整批校验全保留,phase 换成章节/场景结构。

## 4. ask(608 行)+ ask.md/ask-result.md/ask-headless-fork.md

- **schema**:`{html:string}`;`lenientArgValidation` 接受裸 string 或旧 `questions[]` 重建成 HTML(recoverAskHtml:79-112,旧形状 `[{id,question,options:[{label,description?}],multi?,recommended?}]` 正好是我们 ask_user 的拷贝对象)。
- **描述(ask.md 策略段,抄)**:「Ask only for materially different tradeoffs the user must decide. Default: act…pick conservative/standard, proceed, state choice」;表单规则:每控件要 `name`、radio=选一、checkbox=选多、自动注入「Other」行(「NEVER add your own 'Other' option」)、`checked` 预填推荐(超时按它提交)。
- **错误/边界**:`"the form has no named controls…"`;超时=`details.timedOut:true` 非 isError;取消 `ToolAbortError("Ask input was cancelled")`;被打断时交出已填部分(ask-result.md 模板)。
- **并发**:`exclusive` 且有注释说明原因:单一共享 UI 面,两个 ask 并发会互相盖——Electron 对话卡同理。
- **依赖**:TUI/html-form/Bun.escapeHTML/vocalizer 全删。**判定:只参考**。`ask_user` 拿:策略文案、exclusive、超时交默认、打断交已填、旧 questions[] schema。

## 5. web_search(web/search/index.ts 664)+ web-search.md;fetch 无独立工具

- **schema**:`{query, recency?:'day|week|month|year', limit?, max_tokens?, temperature?, num_search_results?}`。
- **描述(web-search.md 全文 8 行,可抄)**:`Known URLs/programmatic data → read. Query: site: or -site:, after:/before: YYYY-MM-DD, inurl:, intitle:, filetype:, "phrase", -term, OR. Hacker News → site:news.ycombinator.com. Prefer primary sources; MUST link citations.`
- **结果**:`formatForLLM`:Note 行在前 → answer → `## Sources` `[i] title (age)\n url\n snippet≤240` → `## Citations` → `## Related` → `Search queries:` 前 3。provider 链失败注 `answered by X after A failed (reason)`;reason 拍平 ≤240。
- **并发**:shared,`approval="read"`;429 provider 5 分钟冷却表。
- **fetch**:无此工具——URL 读取折叠进 `read`(parseReadUrlTarget/materializeReadUrlToFile);输出信封 `URL:…\nContent-Type:…\nMethod:…\nNotes:…\n---\n<正文>`;`FETCH_DEFAULT_MAX_LINES=300`+50KB,`firstLineExceedsLimit` 回退字节预览;流级 50MiB 上限通知。
- **判定:web_search 只参考**(输出契约与「Note:」前缀约定可抄;provider 瀑布不传)。**fetch 不要**——但信封头格式和超长行字节兜底值得搬进 `read_*`。

## 6. glob(710)+ grep(1504)+ jfind(~250)

- **glob schema**:`{path?, hidden?=true, gitignore?=true, limit?:1..200}`;模型爱送的 `pattern` 未声明,`globSearchPath()` 把 `;`-分隔 path × pattern 做笛卡尔积并显式报错引导(`glob has no X argument; put the glob in path`)。
- **glob 结果/错误**:mtime 排序、跨目标去重、200 上限、5s 超时返回部分+`"returning N partial matches — results are incomplete, scope to a deeper directory instead of retrying blindly"`;空→`"No files found matching pattern"`+`.useless()`(压缩可丢)。
- **grep schema**:`{pattern, path?, case?=true, gitignore?, skip?}`(`case` 默认敏感,`skip` 翻**文件**页)。
- **grep 截断多层**:20 文件/页、`MULTI_FILE_PER_FILE_MATCHES=10`、单文件 50、总 2000、30s、行 512B、跨文件轮转插样;通知**在字节截断后追加**(suffix-reserve 循环,反复重裁直到通知放得下,`grep.ts:1351-1368`——这招抄);原句 `Showing files A-B of T. Use skip=N for the next page`、`No matches found`、`Gitignored files match (e.g. X); pass gitignore:false`。
- **find**:需要裁判模型(jfind/cascade.ts),我们没有 judge 角色。**不要**,但其输出排版 `path:start-end score snippet` 与「not evidence of absence」措辞可备用。
- **依赖**:glob/grep 的执行层是 napi(Rust walk/ripgrep)+`Bun.file`——策略层(上限、分页、通知、轮转)是纯 TS 可抄。**判定:glob/grep 只参考**。我们的 `find_term`/素材检索量小,JS 正则遍历 `.nvs`+assets 就够;抄:skip 分页、每文件配额+单文件大放、字节截后追加通知、轮转插样、`.useless()`。

## 7. eval(1140)+ eval.md

- **schema**:`{language:'py|js', code, title?, timeout?, reset?}`,按启用后端动态收窄 enum。
- 要点:lazy 文档(`xd://eval/<topic>` 按需读)省 prompt;`tail buffer`+head-elision;`"Command exited with code N"`;后端缺失报错先给 remedy(`"Python backend is unavailable…Pass language:\"js\"…"`)。
- **依赖**:Bun kernel+Python 后端,全部不可移植也不需要。**判定:不要**。若以后想要 JS 试跑 `.nvs` 逻辑,只借 schema 形状与 tail-buffer。

## 8. generate_image / image-gen(434)+ image-gen.md

- **schema(结构化,不是一个大 prompt 串,直接抄改)**:`{subject, action?, scene?, composition?, lighting?, style?, text?, changes?:string[], aspect_ratio?:'1:1|3:4|4:3|9:16|16:9|3:2|2:3', image_size?:'1024x1024|1536x1024|1024x1536', input?:[{path?|data?|mime_type?}], model?}`。`assemblePrompt` 拼 subject+action+scene,补 `. ` 分句、`\n\nText: …`、`\n\nChanges:\n- …`。
- **描述(image-gen.md 12 行)**:「Generates or edits images with the configured image-model role」「Multiple input: identify each image's role in subject (Image 1 composition; Image 2 lighting)」「Text: request 'sharp, legible, correctly spelled'; keep it short」。
- **错误**:`"Image file not found: p"`、`"Image file too large: p"`(>35MB)、`"mime_type is required when providing raw base64 data."`;全链失败 AggregateError:`"Image generation exhausted the resolved image chain: {models}. Failures: {每条≤300字拍平}. Skipped: {provider/model (reason)}."`——跳过理由链可抄。
- **结果**:图存 `os.tmpdir()/omp-image-<snowflake>.<ext>`,**只回文本**:`Provider: X`、`Generated N image(s):` + `  /tmp/path (1024x1024, quality high)` + provider text;details 里放图对象。不回 base64/图像块。
- **依赖**:`Bun.file().bytes()`、`Bun.write`、`Bun.Image`(尺寸不符时重采样)、pi-ai `generateImage` 多 provider 派发(openai-responses 需要 carrier model;尺寸映射 1:1→1024²、竖→1024x1536、横→1536x1024)。**判定:移植改写 → `draw_image`**。但我们契约更简单:`{prompt, negativePrompt?}` 模型只填描述,素材/尺寸/参考图/审核/重画计数全在代码里——所以**schema 结构(subject/scene/text 分字段拼 prompt)借给它内部的 prompt 组装器,工具表面维持两字段**;尺寸映射、跳过理由链、只回路径+元数据这三点直接拿。

## 9. task / 子代理(src/task/*;executor 5736 行,引擎不可移植,契约可移植)

- **schema**:批量 `{context:string, tasks:[{agent?, task, name?, solutionSpace(必填!), outputSchema?, isolated?, model?…}]}`;`"+":"delete"` 剥未声明键;`lenientArgValidation` 放行让工具自己的错误先触达。
- **描述(task.md Handlebars,骨架可抄)**:`# Inputs` 段——「context: shared (`# Goal`, `# Contract`); NEVER repeat per task」「task: self-contained (`# Target` files/non-goals, `# Change` steps/APIs, `# Acceptance` observable result)」「Children start blank; large payloads via local://<path>, NEVER inline」「solutionSpace: how open-ended the child's problem is…NEVER mention sibling agents」+ agent 花名册带 `(read-only, no edits)/(BLOCKING)/(STRUCTURED)` 标记。附生 spawn 后忠告(task-coordination-advisory.md/task-specialization-advisory.md)是**追加在结果里**不进描述。
- **结果信封(task-summary.md,抄)**:`<task-result id agent status duration><meta lines size/><error/><output>全量</output>|<preview full-output="agent://id">头</preview></task-result>`;内联上限 11.5K 字符,预览头 5K 按行界切;全量落 artifacts 文件+JSON sidecar。
- **yield-assembly**:`yield {type:[label],data}` 增量段累积(数组合并标量替),无 type=终态;子代理没交 yield 时 `SYSTEM WARNING: Subagent exited without calling yield tool after 3 reminders.`——**直接对应我们 `submit_*`+finishTurn 的提醒文案**。
- **并发**:session 级 Semaphore 限子代理并发(可 resize);`parallel.ts` 的 `mapWithConcurrencyLimitAllSettled`(~150 行零依赖,**直接拷贝**);provider 并发另有一把只包 stream 的锁(父等子不死锁)——我们无 provider 限额可跳;递归深度 `taskDepth` 上限 + `PI_BLOCKED_AGENT` 环境变量。
- **read-only**:白名单子集判定,`fail-safe: 未知工具⇒非只读`;只读角色直接不给写工具,没有运行时拦截。
- **依赖**:executor.ts 深度绑 omp session/IRC 不可移植;isolated/worktree/ovnfs 一串 `Bun.$`/`Bun.file` 删;`Bun.sleep`→setTimeout 一处。**判定:移植改写 → `sub_agent`**。拿:schema(context/tasks[]/solutionSpace 必填)、`# Target/# Change/# Acceptance` 任务契约、「children start blank」、`<task-result>` 信封+内联上限、yield 警告文案、Semaphore+allSettled、只读白名单判定。丢:steps/workpool/isolated/IRC/per-provider 锁。

## 10. yield(762)+ yield.md/wait(673)+ wait.md

- **yield schema**:动态构 JSON Schema `{type?:string|string[](数组=增量段), data?:<outputSchema>, error?:string}`,workpool 变体加 `key`;`strict` 除 loose/workpool 外 true。
- **描述(yield.md 近乎原样就是我们的 `submit_*` 契约)**:`Submit subagent output: { data: <your output> } for success, { error: "message" } for failure. Never both; never a bare payload outside data. Omit type for the usual single terminal result.`
- **错误+重试预算(抄)**:`"yield must contain either \`data\` or \`error\`…Empty result retries remaining before abort: N"`;`MAX_SCHEMA_RETRIES=3` 后**接受并标 schemaOverridden**(不是无限拒);`MAX_EMPTY_RESULT_RETRIES=3` 后 abort;`parseYieldError` 容忍 `"ignore","n/a","unused"` 这类占位 error 与合法 data 并存;string data 校验失败时试 JSON.parse 一次再校验;成功回 `"Result submitted."`,失败交 `"yield cannot contain both data and error…"`+期望形状。**判定:移植改写 → `submit_*`+finishTurn**;这套「3 次后 permissive 接受+标记」正是 pi-scaffolding 已定设计,omp 给了完整语义与文案。
- **wait**:`type({})` 零参;`exclusive`+interruptible+handlesToolInterrupt(消息/插话提前结束而非 abort);阶梯 `WAIT_LADDER_MS=[5s,240s]`;reply-wait 顶窗=prompt-cache TTL−60s 封顶 30min;2+ 次连续空等后注入 wait-idle.md `<system-notice>`(「Waiting is not progress…NEVER start sleep jobs」);文案 `Nothing to wait for: X is waiting on you…Answer it first`。**判定:只参考**——我们工具循环无 job mesh,但「wait 只在真阻塞、结果作为下一轮自动送达、空等阶梯、system-notice 提醒」四条语义可搬进 `finishTurn`/子代理等待。

## 11. hashline 移植验证(/tmp 原型,Node 24 实测)

- **位置**:`/tmp/hashline-proto/`:`xxh32.mjs`(纯 JS xxHash32,28 行)+ `hashline.mjs`(节解析+op 降维+apply+HashlineStore+stagePatch,278 行)+ `test.mjs` + `sample.nvs`。
- **bit 级一致**:`fileHash` 对 Rust 测试向量 `("a \n b\t\r\nc","80BA")` `("hello\n","5BF9")` `("","5D05")` 全中——xxh32(seed0,每行去尾空格/Tab/CR 后哈希,取低 16bit 四 hex 大写)。
- **实测通过**:`PUT 5.=5:` 单行替换、`PUT >8:` 锚后插、`CUT 3.=3` 删、多 op 一批、`PUT <1:` BOF、`PUT >$:` EOF、`stale_tag`(磁盘已变,回当前 tag 让重读)、`missing_tag`、`other_file_tag`(tag 是别的文件的)、`out_of_range`、`unseen_lines`(seen 集外锚点拒)、`no_change`(整批无效果拒)。`.nvs` 样例上 patch 正确落。
- **实现量评估**:子集(无块 op/寄存器/流式/语法复检/recovery)= tokenizer+parser op 部分 ~200 行 + apply/render ~120 + store ~80 + 错误文案 ~100 ≈ **500 行 JS,零依赖**。块 op(`N*`)若想要,`.nvs` 语法简单(scene 头到下个 scene 头、`choice` 块到同级非缩进行)——一个 50 行的「块解析器」就够,不需要 tree-sitter。
- **对我们的价值判定**:`.nvs` 场景改写现行契约是「整场新文本+句子 ID diff」(novelive-agent.md:108),句子 ID 已是稳定锚;hashline 提供的增量是:**(a) 快照 tag 让「读的版本」和「改的版本」严格对齐**(防止模型对着旧读改新文件);**(b) `N:` 行号+seen-lines 让改写工具能做行级局部改**——如果场景改写工具从「整场重出」改成「局部 patch」(大场景省 token),hashline 是直接可用的协议;**(c) `apply_staging_patch`(美术导演 DSL)可借它的「parse→校验→apply→回真 tag」骨架和错误分类**,尽管它的目标不是 `.nvs` 文本而是 manifest staging。**建议:hashline 协议移植留作场景局部改写的备选协议;`apply_staging_patch` 借其校验-错误分类-快照三段式;`write_content` 的 strip/evidence 现在就抄。**

## 12. 总评:推荐移植 top-10(按性价比排序)

1. **hashline 子集**(§2/§11):~500 行换「带版本锚的局部 patch」能力 + seen-lines 取证;`.nvs` 场景改写和 `apply_staging_patch` 共用底座。
2. **read-selector + 行选区语法**(§1):136 行直接拷贝,所有 `read_*` 统一 `:N-M/:raw/:-尾` 语法与报错。
3. **truncateHead 家族 + 通知后缀追加**(§0/§1/§6):~150 行,输出截断与「never cut the notice」策略,`read_*`/搜索结果全靠它。
4. **yield/submit 契约**(§10):`{data}|{error}` xor、3 次重试后接受+标 overridden、占位 error 容忍——`submit_*`+finishTurn 的完整语义与全部文案。
5. **write-content strip/evidence**(§1):模型糊回编号输出不毁文件,~80 行进 `apply_staging_patch` 输入清洗。
6. **task 契约+信封**(§9):`context`+`tasks[]`+`solutionSpace`+`# Target/# Change/# Acceptance`+`<task-result>` 11.5K 内联/5K 预览;`sub_agent` 直接按此定。
7. **image-gen 结构化 prompt 字段+结果格式**(§8):subject/scene/text 分字段组装进 `draw_image` 内部;只回 `Generated: path (WxH)` 文本。
8. **read 结果格式全套**(§1):`[path#TAG]` 头、`N:` 前缀、`…` 省略行、单范围 1+3 上下文、全部 `[…]` 通知原句。
9. **todo op-union+verbatim 寻址+汇总重渲**(§3):`propose_plan` 或主控计划工具照抄;「NEVER takes a turn of its own」写进描述。
10. **错误语气与 lenientArgValidation 边界**(§0/§3/§4):报错给合法写法+例子;自然语言字段可修,代码/patch 字段绝不自动修;`"+":"delete"` 剥未声明键放行走工具自有错误。

## 13. 我们设计里的缺口(omp 有、spec/research 尚未覆盖)

- **seen-lines 取证**(§1):omp edit 默认拒锚到模型没见过的行(读窗口外/省略区/列截断行)。我们的 `apply_staging_patch` 规格没有这条——照 hashline 移植时带上,否则模型对着省略区写锚点会静默毁内容。
- **同批读写顺序**(§1):omp read 执行前 `await earlierEffectsSettled`——同一条助手消息里 write 在 read 前时,read 等写落盘再读。我们的批内并行工具调度规格没提;pi-agent-core 并行批次需要同样的 barrier 语义,否则 read_scene 可能读到批内旧版。
- **占位 error 容忍**(§10):模型常在 schema 必填 error 字段塞 `"none"/"n/a"`;omp 有固定 filler 清单容忍+parse。我们 finishTurn 校验规格没写这条,会导致误拒。
- **schema 重试后降级**(§10):omp 是「3 次后接受+标 overridden」不是「3 次后标记需要处理」——我们定的是后者;建议改成 omp 语义(收下数据继续走,标记供审计),更符合「错误即教材」且不打断流水线。
- **`.useless()`/结果可弃标记**(§6):空结果打标让压缩丢弃。我们的压缩规格(m0)没区分「已消费可丢」vs「需保留」——`read_*` 空结果、过期快照头都该带这个标记。
- **批准层级 vs 并发维度的分离**(§0/§6/§9):omp 把 `approval`(read/write/exec 档,可 per-arg 函数)与 `concurrency`(shared/exclusive,可 per-arg 函数)做成两个正交声明,再加 `approvalCacheTargets` 做按目标记忆授权。我们的确认闸门规格(beforeToolCall 拦截)是单维的;`propose_*` 适合 approval 维,`read_*`/并发安全适合 concurrency 维——建议照此拆成两个字段而不是一个布尔 needsConfirm。
- **ask 超时交默认+打断交已填**(§4):确认卡规格没写超时/打断语义;omp 的 `timedOut:true` 非错误、`checked` 预填推荐,直接搬。
- **spawn 后忠告进结果不进描述**(§9):协调/专精建议作为 tool result 追加文本——比塞进系统提示省 token 且贴近触发点。
