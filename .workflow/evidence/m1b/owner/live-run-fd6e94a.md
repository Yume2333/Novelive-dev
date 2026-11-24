# M1b/11：合入 #107 后恢复绘制

2026-11-24 · main `fd6e94af5606d52f9b8a778712cd00109a2fcbee` · **第一章带占位图发布并到达确认点 2；监看器排空后关闭 Electron，未试玩。**

在真实 Electron 中打开 [53cc1d52 断点](https://github.com/Yume2333/Novelive-dev/blob/d1063af7719861735634f741bc5e3e20ddfce159/.workflow/evidence/m1b/owner/live-run-53cc1d52.md)的新副本，原副本不用于生产。新窗口为 2,000,000 tokens／50 张图，应用软停止线为 1,600,000 tokens，监看线为 1,800,000 tokens／45 张图或单笔核销超过其预留的 2 倍。

| 步骤 | 结果 |
| --- | --- |
| 构建和路由预检 | Electron 构建成功；供应方配置使用 HTTPS `/v1`。仅回环网络中的 Electron 验证了聊天（5 次）、生图（2 次）、编辑（1 次）和下载（3 次）。 |
| 被动重开 | 打开项目并进入制作页，零新准入。 |
| 继续绘制 | 在 Electron 中点击一次「继续制作」。31 笔新准入均属绘制，没有重复写作、章节审查或演出；新录制的请求指纹与已验证断点中的七笔提示改写及两笔生图均不匹配。没有手动重发或 W4 请求。 |
| 停止 | 变体绘制报告 `[reasoning_limit] Model generated reasoning but no answer` 并使用占位图。监看器记录 `SOFT STOP: task failure image: final; draining in-flight tasks`，停止新准入，等待已派发的请求核销后关闭 Electron。没有触及预算线或单笔超限。 |
| 发布与试玩 | 排空期间第一章发布，数据库进入 `awaiting_confirm / confirm_first`（确认点 2）。11 个绘制任务完成：10 个正常、1 个占位。Electron 关闭前未试玩，无试玩截图；第 2–4 章未启动。 |

## 对账与释放

| 范围 | 已核销 tokens | 已核销图片 | 未核销 tokens | 未核销图片 |
| --- | ---: | ---: | ---: | ---: |
| [本窗口](live-run-fd6e94a-usage.csv) | 141,076 | 13 | 0 | 0 |
| 项目累计 | 2,108,451 | 27 | 2,279,931 | 20 |
| [共享账本累计](../../usage-ledger/reconciled-ledger.csv) | 5,362,250 | 55 | 3,453,975 | 22 |

SQLite 与 CSV 的 31 笔准入逐笔匹配；31 笔核销均匹配完整的 HTTP 200 录制（18 笔聊天、9 笔生图、4 笔编辑），此前的 151 笔预留不变。13 笔 Sunburst 请求均各返回一张图。监看暴露峰值为 **822,418 tokens／27 张图**。排空后释放未用余量 **1,858,924 tokens／37 张图**；历史未核销预留未释放。原始录制留在仓库外。

M1b/11 未通过完整真书 Check。没有改动 W4 评分器或 `0.90` 阈值。
