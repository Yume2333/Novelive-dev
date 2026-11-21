# Standards

本文件优先于 `CONVENTIONS.md` 和 `STYLE.md`，保持一屏以内。

## Project

Novelive：Electron 桌面应用（Windows/macOS/Linux）。创作者导入小说（TXT、EPUB、Markdown、DOCX、PDF 五种格式），由 Novelive Agent 改编成视觉小说并导出 `.novelive` 作品包；玩家导入作品包游玩。产品与边界见 `docs/`，旧实现只读参考在 `../Novelive-legacy`。

## Commands

环境前提：Node 24（24.22.3）、pnpm 12（12.21.0）、Electron 45.4.1（完整锁定表见 `docs/architecture.md`「版本锁定」）。

M0 搭好 pnpm workspaces 骨架后填写安装、运行、测试、类型检查命令。在那之前只有原型：

```sh
cd prototype && npm install
cd prototype && npm run dev
cd prototype && npx tsc --noEmit
```

Real path: M0 之后启动 Electron 应用，把流程实际走一遍；在那之前用浏览器打开原型页面。
Evidence: `.workflow/evidence/`（界面验收截图和日志进仓库；生图对比试验图片按目录 `.gitignore` 排除；录制文件放 `tests/fixtures/`。仓库是公开的，Key、中转地址和测试用书原文不进仓库）

## Layout

- `docs/`：产品与架构文档
- `DESIGN.md`：界面设计指南
- `prototype/`：界面原型（假数据），只作参考；控件库和 Tokens 由正式代码复用
- `.workflow/`：决策、术语、规格、任务
- 正式代码目录见 `docs/architecture.md`「代码组织」（M0 只建 `packages/ui`、`packages/creator`、`apps/desktop`、`tools/dev-bridge`，不建空包）

## Development environment

- 真实接口：地址和 Key 读环境变量 `NL_IMAGE_BASE_URL`、`NL_IMAGE_API_KEY`，文本和图片共用。开发默认模型见 `decisions.md` 2026-11-21「开发期接口和模型用所有者的中转」，其中图片模型已改为 `gpt-image-2.6-sunburst`（见 2026-11-22「补记未写明的取代关系」）。
- 花费：日常开发和测试用录制回放；调提示词用 5 到 10 章切片；每个里程碑整本真跑最多一次。
- 测试用书：`~/novelive-testbooks/`，所有者放入；目录为空时依赖真书的任务标 `Status: blocked`（等书），其余照常推进。

## Unattended runs

所有者不在时按 `decisions.md` 2026-11-21「无人值守推进到 M5 本地安装包」推进 M0 到 M5，不发起提问。
- 里程碑验收：没参与编写的审查 agent 对照规格的 W 检查和原型逐项验收，证据存进 `.workflow/evidence/<effort>/`。通过后 spec 写 `**Accepted:** <日期> by agent (unattended)`，再关闭并开下一个里程碑。
- 等所有者的事（测试用书、签名、品牌图标、发布地址、翻译抽查）：这件事的任务标 `Status: blocked` 并写明在等什么，记入 `.workflow/owner-review.md`，然后继续做不依赖它的任务和后续里程碑。
- 停下的条件：没有不被阻塞的任务可做。
- agent 自己定的、改起来费事的选择记进 `decisions.md`（`Decided by: agent (<effort>/<NN>)`），并在 `owner-review.md` 留一行。

## Code conventions

- 界面必须遵守 `DESIGN.md`；颜色、间距、圆角只用 Tokens。
- 播放器包不依赖创作端；界面只通过 `@novelive/creator/contract` 引用创作端的命令和事件类型。
- 「不做防御性设计」只管产品代码，不放宽上面的开发期规则。

## Branches and landing

Landing: local-merge（并行任务各用一个 worktree，本地合并到 `main`；每个任务落地后 `git push origin main` 推到 `Yume2333/Novelive-dev`）
See CONVENTIONS §7.

Worktrees: `.workflow/worktrees/`
