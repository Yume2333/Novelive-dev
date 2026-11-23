# M1b/11 · 《浮生六記》真书运行

2026-11-23 · main `2fbd4d7d5e939590f204d9f7271c2a3aaabf530c`（合入 #96） · **未通过：第一章演出阶段的模型回复不是合法 JSON**

## 真书 Check

授权窗口 2,000,000 tokens／50 张图。保持默认并发、主模型 5 倍输出预留、1.6M 软停止线、每张图预留 7,000 tokens。单笔核销未超过预留 2 倍，已核销加未核销的监看峰值为 1,002,402 tokens／3 张图，未触及 1.8M tokens／45 张图停止线。

| Check 步骤 | 结果 |
| --- | --- |
| 构建与离线路由 | 通过。桌面构建完成（`✓ built in 5.54s`）；仅回环可达的真实 Electron 预检观察到 `POST /v1/chat/completions` ×5、`POST /v1/images/generations` ×2、`POST /v1/images/edits` ×1、`GET /v1/stub-image.png` ×3，无意外路由或付费请求。 |
| 导入与原文溯源 | 通过。全新私有 Electron 工程，UTF-8 Wikisource TXT，选择繁体中文；保存的原文字节一致，无导入问题或附加参考。 |
| 卷章核对 | 通过。一卷四章，段落数为 25、17、27、42，共 111 段。 |
| 后台预处理与综合 | 通过。保存首卷综合与角色资料；综合用量均已核销。 |
| 首卷角色与主视觉确认 | 通过确认点 1。三份主视觉均完成生成与视觉审查；选择并确认第 2 份，画面取向更符合沉静的清代文人风格，随后进入第一章制作。此处仅核对确认流程与主视觉取向，不算章节美术验收。 |
| 第一章制作 | 失败。写作和审查步骤完成，保留九场草稿；演出阶段因 JSON 解析失败而停止，界面报告需处理。未重试。 |
| 第一章发布与本地试玩 | 未到达。界面为已发布 0／4 章，无可试玩成品。 |
| 第二确认点与手动继续 | 未到达。 |
| 第二至第四章与作品质量 | 未到达。后三章仍排队。第一章只有未演出的草稿，无法验收演出、插图与可玩性；未给出成品质量结论。 |
| 用量对账 | 通过。60 笔准入与 SQLite、私有 CSV 一致；60 条 HTTP 200 录制的 token／图片用量与已核销账项逐值匹配，无新增未核销。 |

## 停止原因

SQLite 的第一章步骤记录为 `write completed`、`review completed`、`stage failed`，与真实 Electron 的报错一致：`Expected ',' or '}' after property value in JSON at position 1917 (line 1 column 1918)`。最后一笔为演出模型的 HTTP 200 流式响应，结束原因为 `stop`，供应方用量为 22,509 tokens 并已核销。用实际 `parseModelJson` 离线解析私有录制的回复文本，复现同一错误；不是预算拒绝或用量未知。

演出经 `directChapterArt` 调用 `artJson`；后者先解析 JSON，再校验 schema。演出只对 `ArtResponseSchemaError` 做一次 schema 修复；此次原始 `SyntaxError` 发生得更早，未进入已有修复路径。下一步先离线验证：对已核销的演出回复语法错误提供一次有界修复，并保持预算准入，不重发用量未知的请求。修复与下一次真书授权不在本次窗口内。

## 对账与释放

[脱敏用量](live-run-2fbd4d7-usage.csv)：**745,431 已核销 tokens／3 张图；无新增未核销账项**。已停止 Electron 和监看进程，释放 **1,254,569 tokens／47 张图**。共享账本为 **3,999,230 已核销 tokens／31 张图，1,174,044 tokens／2 张图未核销**；原有未核销账项不变。

私有运行目录 `~/novelive-testbooks/m1b-private-run/live-2fbd4d7/` 保留导入、确认和停止截屏（`01-import-review.png` 至 `05-chapter1-stage-stop.png`）、SQLite、CSV 与日志；不提交原文、截图或请求响应。M1b/11 继续阻塞，未发出 M1a W4 请求，0.90 门槛不变。
