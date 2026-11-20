# Research: 待定的技术与设计事项

## Settled & ruled out

- Agent 底座用 pi，Schema 用 TypeBox，工程幕后数据用 SQLite（见 `decisions.md`）。dsh 已排除：官方嵌入方式是另起子进程，协议里没有取消请求，自带数据目录，处于开发者预览阶段。
- 搭骨架时要核实：Electron 内置 Node 能否用 `node:sqlite`，不行就用 better-sqlite3。
- 不再使用 AstraLoom 这个名字；创作 Agent 就叫 Novelive Agent。

## Open questions

- [ ] 角色长相保持一致的做法：母图 + 图片编辑派生，还是每张单独生成并带参考图。M1 出图时试过模型再定。
- [x] 界面原型、导航方式、主题：原型在 `prototype/`，见 `DESIGN.md`。
- [ ] 品牌图标。
