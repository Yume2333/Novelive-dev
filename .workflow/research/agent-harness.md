# Research: 待定的技术与设计事项

## Settled & ruled out

- Agent 底座用 pi，Schema 用 `@earendil-works/pi-schema`，工程幕后数据用 SQLite（见 `decisions.md`）。dsh 已排除：官方嵌入方式是另起子进程，协议里没有取消请求，自带数据目录，处于开发者预览阶段。
- 不再使用 AstraLoom 这个名字；创作 Agent 就叫 Novelive Agent。
- 界面原型、导航方式、主题：原型在 `prototype/`，见 `DESIGN.md`。
- 技术选型、图标（lucide）、Key 存法、作品与存档位置、画面规格、审核拒绝处理、界面翻译、自动更新：见 `decisions.md` 2026-11-20 各条。

## Open questions

- [x] Electron utility process 里能否用 `node:sqlite`：实测可用（Electron 45.4.1 / Node 24.22.3，不带 flag，WAL 正常）。better-sqlite3 不再需要。
- [x] 角色长相一致：造型基准图重画、表情编辑派生，见 `character-consistency.md`。
- [x] Novelive Agent 内部设计：编排见 `agent-orchestration.md`，各阶段细节见 `novelive-agent.md`。剩下按卷综合的分块做法（M1a）和各角色提示词正文（M1a、M1b），实现时用测试用书定。
- [ ] 测试用书：由所有者选好放到 `~/novelive-testbooks/`，不进仓库。书到之前，M1a 先用合成小样本做解析、导入和单元测试；依赖真书的部分标 `Status: blocked`（见 `owner-review.md`、`decisions.md` 2026-11-21「测试用书由所有者选」）。
- [ ] 品牌图标：发布前重新设计，等所有者（见 `owner-review.md`）。

## 审查建议的处理结果（2026-11-21）

- [x] 采纳：录制回放的假服务（M0 起）、剧本检查与局部修复（M1a）、质量评测集（M1b 起）、确认点 1 只要第一卷的主要角色（M1b）、同义表情合并（M1b）。见 `decisions.md` 2026-11-21 各条。
- [x] 质量评测集的评分形态（决策 2026-11-21「调研后的取舍」）：多维评分 + 检查清单 + 机械指标三层——judge 用快速模型槽、与被测模型分开，经 `submit_*` 工具交 `{score, reasons[], failedChecks[]}`；失败分类固定：原文忠实度（漏段/加戏/对白改写/归属错/独白降级）、设定一致性（含 knows 违规）、伏笔、演出可拍性、量化指标（对白占比/句长/视觉标记密度）。runner 自写不装框架，评测统计口径 decided-trials-only；录制文件里的大图片另存。runner 细节见 `pi-scaffolding.md` 通用层 7。
- [x] 审稿形态（决策 2026-11-21「审稿拆成忠实度检查和文风审稿」）：拆两档，忠实度检查默认开（只查漏段/加戏/对白改写/归属错/独白降级/顺序不连贯/设定冲突，每条必须引用原文段落并由代码核对），文风审稿保留作品开关默认关（只评文笔）；提示词写明评什么、不评什么。
- [x] 不做：开工前花费预估，维持“花费只做统计参考”。
- [ ] 暂不做：设定条目的原文引文证据放 M2（“第几章揭示”字段提前到 M1a，决策 2026-11-21「调研后的取舍」）。
- [x] 美术导演按场景分批（M1b）：已定，默认读整章，分批只在整章放不进上下文时兜底（决策 2026-11-21「第三轮实测后的取舍（按证据定）」，见 `agent-orchestration.md`）。
