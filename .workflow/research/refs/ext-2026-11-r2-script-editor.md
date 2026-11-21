# R2 · script-editor：行内 ID 稳定的剧本编辑器选型

## 1. 结论

- **推荐 CodeMirror 6**（`@codemirror/state`+`view`+`merge`，MIT）。行式 CJK 文本、装饰/行挂件/gutter、IME 组合、大文档、撤销历史全部实测通过；`@codemirror/merge` 的 `unifiedMergeView` 直接给出"整段重写→内联差异→逐块勾选接受/拒绝"，正是"重写场景=整场新文本+句子 ID 差异列表"需要的形态。
- **行 ID 方案确定**：把 `#xxxx` 从文档文本剥离，存成一个 `StateField<RangeSet<LineID>>`；每个 ID 是一个 `[line.from, line.to]` 的非点区间，`startSide=endSide=1`。ID 不可被当文本编辑，但随事务映射。实测：行内输入/拆行/并在前插行/部分删字/IME 组合均存活；整行删（含换行符）或剪切时 ID 按预期消亡。
- **ID 存亡规则**（自研但简单）：ID 死当且仅当某事务删除区间覆盖该行**含换行符的全部位置**；删空行但留空行 → ID 留（行还在）。`iterChanges` 收集删除段，对每 ID 做区间减法，约 30 行。
- **Agent 重写→差异列表根本不需要文本 diff**：模型输出带 `#id` 标记的整场新文本，按 ID 分类：旧 ID 在→`修改`（比 strip 文本）；旧 ID 消失→`删除`；无 ID→`新增`。Myers 仅用于 hunk 排序/展示。实测：文本相似的行被 jsdiff 拆成 DEL+ADD，但 ID 分类正确标为 `修改`——这证明**不能**只靠行 diff 回映射，必须靠模型保留的 ID。
- **Monaco / ProseMirror·Tiptap / Lexical 都排除**：Monaco 是大块头 code editor（worker、几百 MB 量级、行内 suggestion API 与"行 ID+差异列表"模型不匹配）；Tiptap 的 Tracked Changes 是**付费 Pro**（`tiptap.dev/pro-license`，与免费 AI Toolkit 分开卖）；Lexical 是块结构富文本，CJK IME 问题不断（#6377/#7779/#8098/#9235 等），且块模型与"一行一 ID"的行式剧本不符。
- **撤销**：`@codemirror/commands` 的 `history` + `invertedEffects` facet + `isolateHistory`。Agent 应用差异块是一笔带 annotation 的事务，Ctrl+Z 一次回滚整块；`userEvent:"accept"` 已在 merge 内部使用。手改历史持久化清单进 `project.db` 与撤销栈解耦（撤销只本次会话，符合 handoff-defaults）。
- **Ren'Py 对照**：Ren'Py 翻译 ID 是内容哈希（内容改→ID 变，issue #5373/#6918 已知痛点）。Novelive 的随机短 ID + 应用补发 + 模型改行保留，是更好的设计，ID 跟踪算法让"内容改 ID 不变"成立。

## 2. 证据

| 结论 | 证据 |
|---|---|
| CM6 行 ID 跟踪可行且正确 | 实测 `idtrack5.mjs`（StateField+RangeSet）：27 场景全过（输入/拆行/并行/上插行/两种删行/移动/IME compose/部分删/全替换/assignID）。`/tmp/nl-r2/script-editor/idtrack5.mjs` |
| 浏览器实测 ID 存活+chip+gutter+merge | Playwright headless Chromium `test.mjs`：12 项全过——真键盘输入、Enter 拆分/Backspace 合并、`CompositionEvent` 组合事件、Shift+End 删除、undo 还原、merge 渲出 16 个差异元素、speaker chip 7 个、ID gutter 4 个 |
| `unifiedMergeView`+`acceptChunk` 可逐块应用 | `unified-test.mjs`：chunks=[{A:12-36},{A:70-87}]，`acceptChunk(view,fromB)` 把该块写入原文档并更新。API 见 `@codemirror/merge@6.12.3` `index.d.ts`：`unifiedMergeView/getOriginalDoc/acceptChunk/rejectChunk/updateOriginalDoc/originalDocChangeEffect` |
| 行间 ID 消亡=整行含换行被删 | `idtrack5.mjs` `update()` 第 41-58 行：`iterChanges` 取 `[fa,ta)` 删除段，对 `[from, to+1]`（含尾换行）做减法，无幸存位置则亡 |
| 性能：re-anchor 廉价 | `perf.mjs`：1000 ID/2000 行，1 行插入+全量重锚 2.5ms；顺序 50 次编辑均 0.41ms。场景级（<200 行）<1ms |
| ID 分类靠模型 `#id` 而非行 diff | 实测 jsdiff `diffArrays`：仅文本相近的行被拆 DEL+ADD；而 ID-first 分类把它正确判 `modify`。算法在 `novelive-agent.md` L116 已写明 |
| Tiptap 建议模式是付费 | `tiptap.dev/pro-license`（2026-10-20 更新）：Tracked Changes 是单独付费产品，不在 MIT 的 `@tiptap/core` 里；`tiptap-track-changes` 第三方 MIT 版存在但生态薄 |
| Lexical CJK IME 不稳 | facebook/lexical issue #6377(CJK android)/#7779(IME deleted text reappears)/#8098(composition format inherit)；deepseek-harness #9235 中文 IME 组字被 DOM 重渲染打断（2026-10） |
| CM6 有 IME 但集中在特定装饰 | codemirror/dev issue #1396(中文)/#1650(语法节点边界)/#1688(bracketMatching 后视觉消失—文档数据完好)；均为已归档 issue、个别装饰触发，行挂件/gutter 方案不受影响（实测组合事件正常） |
| Monaco 不适合 | `monaco-editor@0.57`：`createDiffEditor`/`IStandaloneDiffEditor` 是双模型 diff 控件，无"差异列表勾选→部分应用"原语；编辑器本体依赖 worker+庞大样式，Electron 打包显著增重；inline suggestion 是补全 API 不是 hunk accept |
| Ren'Py ID 不稳定是已知坑 | renpy issue #5373 "IDs are not stable: they can change even when line content is exactly the same"（2023-07）、#6918（2025-02）。Novelive 用显式随机 ID 规避 |
| 许可证 | `@codemirror/{state,view,merge,language,commands}` 全 MIT（各包 LICENSE 文件确认，Marijn Haverbeke）。AGPL-3.0 兼容 |
| 撤销合并方案 | `@codemirror/commands` `index.d.ts`：`invertedEffects` facet、`isolateHistory` annotation、`userEvent`。merge 内部 `acceptChunk` 已带 `userEvent:"accept"` |

## 3. 对照现有设计

| 发现 | 状态 |
|---|---|
| 编辑器引擎选型未定 | **缺口**：`docs/ux.md` 编辑器能力与 `architecture.md` 依赖表均未写引擎。建议把 "CodeMirror 6（state/view/merge/commands/language）" 写进 `architecture.md` 界面依赖行与 M2 规格 |
| 句子 ID 行尾 `#xxxx`、改行保留、存档/已读靠它 | **已覆盖** `work-format.md` L92；本报告给出**编辑器内**不把它当文本、而用 StateField 跟踪的实现——ID 永不因用户敲键盘被误删，保存时序列化回行尾 |
| 重写场景=整场新文本+句子 ID 差异 | **已覆盖** `novelive-agent.md` L112-118；本报告确认差异分类用 ID 匹配（不是 diff），`unifiedMergeView` 提供预览+逐块接受，部分应用=只把勾选 chunk 写回原文件 |
| 编辑立即生效、撤销兜底 | **已覆盖** decisions L160；本报告给出 undo 栈如何合并 agent hunk（invertedEffects+isolateHistory），及"撤销仅本次会话"与 handoff-defaults L62 一致 |
| 修改历史持久化进 project.db、撤销仅会话内 | **已覆盖** handoff-defaults L62、`work-format.md` L137；撤销栈不需序列化 |
| 原文对照/双向跳转 | 与本任务正交，未动 |
| 行内 chip（说话人/表情）、@ 指令高亮、行内标签着色 | **缺口**：需要 `.nvs` 的 StreamLanguage/高亮 + Decoration widget（chip 方案已在 `app.mjs` 用 `ChipWidget`+`chipDeco` StateField 验证可行）。建议 M2 规格加一条"`.nvs` 语法高亮与说话人 chip" |
| 移动行是否保留 ID | **取舍点**（见 §5）：cut→ID 死、粘贴→新 ID（Git/Ren'Py 惯例，且粘贴文本本身无 `#` 标记，实现天然如此）。spec 未明确，倾向"移动=删+增" |

## 4. 可拷资产

| 资产 | 位置 | 许可 | 说明 |
|---|---|---|---|
| 行 ID StateField（含 seed/assign/death-check/re-anchor/dedupe） | `/tmp/nl-r2/script-editor/idtrack5.mjs` L40-84 | 自研 | ~45 行，可直接移植 |
| `parseScript`（剥 `#id`→区间集） | `idtrack5.mjs` L26-38 | 自研 | 加载 `.nvs` 用 |
| Speaker chip widget + decoration field | `app.mjs` `ChipWidget`/`chipDeco` | 自研 | 行尾说话人/表情 chip |
| ID gutter marker | `app.mjs` `idGutter` | 自研 | 行号旁显示 `#id` |
| Agent 重写差异分类（ID-first） | 报告 §1 算法 | 自研 | 与 `novelive-agent.md` L116 一致，~30 行 |
| `unifiedMergeView` 配置（original=现文件, highlightChanges, accept/rejectChunk） | `unified-app.mjs` | 用法示例 | 差异预览+部分应用 |
| 试验页+测试 | `index.html`/`app.mjs`/`test.mjs`/`unified-test.mjs` | 自研 | Playwright 冒烟模板 |

## 5. 需要所有者取舍的事

1. **移动行的 ID 归属**：cut 一行再粘贴到别处——(a) 维持"删+增"，原 ID 消亡、粘贴行补发新 ID（Git blame 惯例，实现零成本，**推荐**）；(b) 通过移动检测让 ID 跟内容走（要做相似度匹配，收益小）。建议 (a)。
2. **差异列表的呈现**：(a) 用 `unifiedMergeView` 内联 hunks + 行内接受/拒绝按钮（**推荐**，与"先差异列表再勾选应用"一致、引擎自带）；(b) 双栏 `MergeView` 并排（占屏更宽，适合长行对照）。可两者皆提供，默认 (a)。
3. **合并行（join two ID'd lines）时保留哪个 ID**：现实现"旧文档中位置靠前者胜"。join 不常见，建议保持；若希望保"显示名更特殊"的，可在 dedupe 里换比较器。
4. **`.nvs` 语法高亮范围**：M2 是否一期做 `@指令`/行内标签/`#id` 高亮 + speaker chip？建议做（引擎成本已在试验中摊平）。
