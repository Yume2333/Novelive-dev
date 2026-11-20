# Standards

Fill this in at project setup and keep it under one screen. Delete lines that do not apply and replace every placeholder. This file overrides `CONVENTIONS.md` and `STYLE.md`.

## Project

Novelive：Electron 桌面应用（Windows/macOS/Linux）。创作者导入小说（TXT、EPUB、Markdown、DOCX、PDF 五种格式），由 Novelive Agent 改编成视觉小说并导出 `.novelive` 作品包；玩家导入作品包游玩。产品与边界见 `docs/`，旧实现只读参考在 `../Novelive-legacy`。

## Commands

M0 搭好 pnpm workspaces 骨架后填写安装、运行、测试、类型检查命令。在那之前只有原型：

```sh
cd prototype && npm install
cd prototype && npm run dev
cd prototype && npx tsc --noEmit
```

Real path: M0 之后启动 Electron 应用，把流程实际走一遍；在那之前用浏览器打开原型页面。
Evidence: `.workflow/evidence/`

## Layout

- `docs/`：产品与架构文档
- `DESIGN.md`：界面设计指南
- `prototype/`：界面原型（假数据），只作参考；控件库和 Tokens 由正式代码复用
- `.workflow/`：决策、术语、规格、任务
- 正式代码目录见 `docs/architecture.md`「代码组织」，M0 创建

## Code conventions

- 界面必须遵守 `DESIGN.md`；颜色、间距、圆角只用 Tokens。
- 播放器包不依赖创作端；界面只通过 `@novelive/creator/contract` 引用创作端的命令和事件类型。

## Branches and landing

Landing: direct（单人开发，直接提交到 `main`；以后并行跑多个任务时改为 local-merge）
- `direct`: commit on the current branch (solo work).
- `local-merge`: merge task branches locally (parallel worktrees under the `Worktrees:` root).
- `pr`: land through pull requests (shared remote).
See CONVENTIONS §7. Name the main branch here if it is not `main` or `master`.

Worktrees: `.workflow/worktrees/`
