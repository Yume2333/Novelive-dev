# Research: 待定的技术与设计事项

## Settled & ruled out

- Agent 底座用 pi，Schema 用 TypeBox，工程幕后数据用 SQLite（见 `decisions.md`）。dsh 已排除：官方嵌入方式是另起子进程，协议里没有取消请求，自带数据目录，处于开发者预览阶段。
- 不再使用 AstraLoom 这个名字；创作 Agent 就叫 Novelive Agent。
- 界面原型、导航方式、主题：原型在 `prototype/`，见 `DESIGN.md`。
- 技术选型、图标（lucide）、Key 存法、作品与存档位置、画面规格、审核拒绝处理、界面翻译、自动更新：见 `decisions.md` 2026-11-20 各条。

## Open questions

- [ ] Electron utility process 里能否用 `node:sqlite`，不行就用 better-sqlite3。M0 核实。
- [x] 角色长相一致：造型基准图重画、表情编辑派生，见 `character-consistency.md`。
- [x] Novelive Agent 内部设计：编排见 `agent-orchestration.md`，各阶段细节见 `novelive-agent.md`。剩下按卷综合的分块做法（M1a）和各角色提示词正文（M1a、M1b），实现时用测试用书定。
- [ ] 测试用书：之后和所有者单独讨论，M1a 开始前定。建议两本：一本主调用的中文书（20 到 50 章、对白多），一本几百章的长书，用来验证分卷建议、按卷综合分块和长章切段。
- [ ] 品牌图标：发布前重新设计。

## 审查建议的处理结果（2026-11-21）

- [x] 采纳：录制回放的假服务（M0 起）、剧本检查与局部修复（M1a）、质量评测集（M1b 起）、确认点 1 只要第一卷的主要角色（M1b）、同义表情合并（M1b）。见 `decisions.md` 2026-11-21 各条。
- [x] 不做：开工前花费预估，维持“花费只做统计参考”。
- [ ] 暂不做：设定条目记来源段落（M2 做设定集编辑时再议）。
- [ ] 美术导演按场景分批（M1b）：章太长时整章剧本一次放不下，按场景分批补演出。记在 `agent-orchestration.md` 的 Open questions。
