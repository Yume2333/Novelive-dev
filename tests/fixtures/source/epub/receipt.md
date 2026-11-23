# M4/02 EPUB 插图分类供应商回执

2026-11-23，协调者授权串行执行三类合成插图分类。模型为用量计划的视觉槽 `gemini-3.8-flash`，通过实际 `classifyIllustrations` → `artJson` → replay 录制；三个返回标签均与预期一致，所有候选仍未选中。

| 用例           | 调用 | 输入 tokens | 输出 tokens | 输入图片 | 生成图片 |
| -------------- | ---: | ----------: | ----------: | -------: | -------: |
| 角色匹配设定集 |    1 |        1214 |         211 |        1 |        0 |
| 场景匹配设定集 |    1 |        1234 |         257 |        1 |        0 |
| 无关装饰       |    1 |        1218 |         187 |        1 |        0 |

成功调用合计 3 次，3666 输入 + 655 输出 = 4321 实测 tokens。另有 1 次首次请求因缺少 `/v1` 路径返回 HTTP 404，没有用量；私有账本保留 40000-token 上界，不记零。总计 4 次请求、4 张输入图片、0 张生成图片；计入预留共 44321 tokens。未因标签不符重试，没有切换模型。

私有文件：`$HOME/.local/novelive-epub-provider/cassette/cassette.jsonl`、`receipt.json`（首次失败）、`receipt-1795403833973.json`（成功批次）。供应商响应均不提交；私有用量逐调用追加到 `~/memory/poke_5b9601/files/novelive/usage.csv` 的既有六列格式，输入/输出明细在 purpose 字段。

提交内容仅为合成 PNG、合成 SSE cassette、驱动及本回执，与先前 cassette PR 的公私分离约定一致。私有 strict 回放三类成功断言通过且无网络调用；普通 CI 使用公开合成 cassette，不依赖私有目录。

## 公版实书插图初筛 · 2026-11-23

样书：[Project Gutenberg #28885 EPUB3](https://gutenberg.pglaf.org/cache/epub/28885/pg28885-images-3.epub)，Lewis Carroll《Alice's Adventures in Wonderland》，Arthur Rackham 插图。SHA-256：`8fc0e5991b8d9b94d70c06026d804e80852e766554ca162bd4fbba2dc093b605`。正文和插图保留在仓库外；`extractEpub` 提取 43 个插图位置，本次只选 183 × 450 的 `p0015-image.png`。

通过制作角色 `illustration-screening` 解析视觉槽 `gemini-3.5-flash-lite`，执行实际 `classifyIllustrations`；HTTP 200，返回有效 `character` 标签。单请求、无重试、仅允许聊天补全；发送前预留 600,000 tokens，上限内按供应方用量结算。

| 模型 | 调用 | 输入 tokens | 输出 tokens | 实测总计 | 输入图片 | 生成图片 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `gemini-3.5-flash-lite` | 1 | 1473 | 36 | 1509 | 1 | 0 |

按接手要求，查阅 `origin/handoff/next-steps` 及远程分支；交接指向的私有台账未挂载，未找到已提交的台账。以上为本次替代回执，未写入共享 CSV；待挂载可据此对账。不提交原始请求、响应、样书或凭据。
