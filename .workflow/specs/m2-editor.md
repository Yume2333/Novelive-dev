# M2 编辑器与 Agent 对话

**Status:** done
**Accepted:** 2026-11-24 by agent (omp-vibe-windows)
**Priority:** high
**Blocked by:** m1b-production/09

## What this is for

对作品进行逐处修改、对照和预览，并能在聊天中提出经确认才生效的更改。

## What it does

移植编辑器、设定集/术语表和 Agent 面板；实时对话可取消，分支、附图、确认/拒绝有持久记录；从编辑器或对话入口重写场景时重写结果按差异勾选。支持文本标记、注音停顿、表情、单图重画、规则与原文双向定位。

## How it is built

用 CodeMirror 6、assistant-ui/streamdown、M1a 已建的 project.db 和 pi；创作者所见快照按宿主事件序列同步。规则按章优先；修改历史长期保存，逆操作撤销只在本次打开有效。

## What it must not do

不做演出时间线编辑器，不做未经确认的 Agent 写入；新标记用编辑器横幅，不扩充聊天确认类型。

## How we will know it works

- **W1.** 在真实 Electron 修改台词、文本效果、表情、设定和术语；重开后修改历史在、会话级撤销不跨打开；原文与脚本双向跳转并从当前句预览。
- **W2.** 对话能流式输出、附图、停止、分支及压缩；未经确认不应用，拒绝理由返回，已过期提议不覆盖新内容。
- **W3.** 两个入口均能重写且仅应用勾选差异；单图重画和保存规则可观察，规则只作用尚未开始的工作。
