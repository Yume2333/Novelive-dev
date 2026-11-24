# M4 长篇、调度与桌面运行

**Status:** done
**Accepted:** 2026-11-24 by agent (omp-vibe-windows)
**Priority:** high
**Blocked by:** m3-playback/07

## What this is for

将生产从单作品扩展到长篇多卷与多作品队列，让桌面应用能后台运行、恢复并呈现用量。

## What it does

添加 EPUB/Markdown/DOCX/PDF 四种导入、系列和卷覆盖、按卷继续、加入已有系列不删除设定、跨语言直接写剧本；完善托盘、退出、崩溃恢复、通知、用量及素材过期。

## How it is built

按 docs 与 handoff 保留排程不变量；同一时刻一个制作槽，写/图可重叠，确认让槽、确认完成回队首不抢占。先固定导入契约，四个提取器按格式独立；原文和费用均有离线验收。

## What it must not do

不做 PDF OCR 或在线平台；不在当前阶段注册作品包关联（M5 有实际导入路径时同交付）。

## How we will know it works

- **W1.** 五种格式都从实际应用导入生成相同结构；EPUB 兜底、扫描 PDF 提示、注释剔除及插图候选需人工选均可验证。
- **W2.** 真实 Electron 运行两部作品、多卷连续生产、重排/让槽/回队首、异常退出保持暂停；系列覆盖与已有设定保留，跨语种输出和过期提醒正确。
- **W3.** 真宿主验证托盘/无托盘、后台通知点击定位、再打开操作和休眠清理；用量面板可读已发生文本及图片用量。
