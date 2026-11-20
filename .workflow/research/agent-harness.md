# Research: 待定的技术与设计事项

## Settled & ruled out

- Agent 底座用 pi，Schema 用 TypeBox，工程幕后数据用 SQLite（见 `decisions.md`）。dsh 已排除：官方嵌入方式是另起子进程，协议里没有取消请求，自带数据目录，处于开发者预览阶段。
- 不再使用 AstraLoom 这个名字；创作 Agent 就叫 Novelive Agent。
- 界面原型、导航方式、主题：原型在 `prototype/`，见 `DESIGN.md`。
- 技术选型、图标（lucide）、Key 存法、作品与存档位置、画面规格、审核拒绝处理、界面翻译、自动更新：见 `decisions.md` 2026-11-20 各条。

## Open questions

- [ ] Electron utility process 里能否用 `node:sqlite`，不行就用 better-sqlite3。M0 核实。
- [ ] 角色长相保持一致的做法：母图 + 图片编辑派生，还是每张单独生成并带参考图。和 M0 并行做对比试验，看图再定。
- [x] Novelive Agent 内部设计：编排见 `agent-orchestration.md`，各阶段细节见 `novelive-agent.md`。剩下按卷综合的分块做法和各角色提示词正文，M1 实现时定。
- [ ] 测试用书：M1 开始前定。
- [ ] 品牌图标：发布前重新设计。
