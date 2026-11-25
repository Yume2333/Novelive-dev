# M1a 工程与全书理解

**Status:** done
**Accepted:** 2026-11-24 by agent (omp-vibe-windows)
**Priority:** high
**Blocked by:** m0-skeleton/11

## What this is for

把 TXT 小说导入可检查的工程目录，按章预览并按卷生成设定集、术语表与剧情骨架，供真实应用在 M1b 消费。

## What it does

按 `docs/work-format.md` 建立工程目录、标识与 `.nvs` 编译；按 `docs/creation-pipeline.md` 定稿 TXT 检测、章节划分、清洗、导入报告与模型结果。预览读完正文、不截断；综合保留候选及已确认版本并支持长卷断点。

## How it is built

先锁定 pi-schema 与 project.db 六类数据契约；用 `node:sqlite`、`.workflow/research/handoff-defaults.md` M1a 和仓库保留的导入片段。保留 `VolumeDigest` 与 `VolumeSkeleton` 的不同职责；会话、历史等表在这里定义但功能在后续接线。

## What it must not do

无创作界面、分卷向导、写手、出图或播放器。不把所有者选书、原文、私有对照结果或中转信息加入仓库。

## How we will know it works

- **W1.** 工程包与磁盘 schema 建库测试通过。暂停并重开的真实项目文件保留身份、源文、表和任务记录。
- **W2.** TXT 边界用例及剧本解析编译测试通过。编码歧义、卷/章规则、附注剥离、场景/行 ID 和诊断均可验证。
- **W3.** 合成多卷 TXT 从导入到预览和综合的严格回放通过。磁盘工程含原文、章段落、报告、分卷摘要、骨架、候选和术语表，冲突不会覆盖已确认条目。
- **W4.** 所有者选书的比较验收通过。整卷与分块对同一真卷做对照，规范化 BiblePatch 条目 F1 ≥0.90，已确认设定无丢失；最多一次整本真跑。若无选书只阻塞此项，不把合成回放称为真书验收。
