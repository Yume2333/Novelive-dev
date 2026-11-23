# [WIP] Novelive 开发交接（2026-11-23）

**未完成，不可视为 M0–M5 已交付。** 所有付费工作暂停；恢复需由接手的串行主线先对账。分支和 PR 保留原提交，不把未验证的门槛打勾。

## 所有者要求与运行配置

> 我想让你跑到直到一个完整的产品交付 文档里的规范和信息应该已经足够了 下面就是你去进行开发任务
>
> 整个开发过程中你也无须问我任何事情 如果确实有一些决策或者选型上的问题 那么你就根据项目的整个调性 选择最优解

Yume 授权自主开 PR 和合入 main；按产品调性自行选型，并报告选项及未选理由。不要因单个 PR 合入触发的工单自动关闭而把整个交付标成完成。全程开发与测试预算：**500 张图，其他模型少于 1000M tokens**。真跑单执行者；离线常用 `NL_REPLAY=strict`，合成回放不可替代真书、真机或平台实测。

- 测试中继：文本和图像共用存储的 `NL_IMAGE_BASE_URL`、`NL_IMAGE_API_KEY`。只绑定引用，不粘贴值，不提交中转地址或凭据。
- 图像：`gpt-image-2.6-sunburst`；`gpt-image-2.6-flare` 已试，未解决真实表情编辑丢 alpha。文本：`devin-swe-2`（256K、快而强，主控与写作）、`deepseek-v4.1-flash`（1M、能力中等、低成本快速槽）、`gemini-3.8-flash`（1M、文笔较好，写作及 JSON 回退）、`gemini-3.5-flash-lite`（能力弱，仅轻量多模态，不用于关键判断）。
- 真书：夏敬渠《野叟曝言》，维基文库一百五十四回本，公版中文原著、章回和人物跨度适合验证长篇抽取、制作与重启。原始 TXT 在 `~/novelive-testbooks/yesou-puyan.txt`。项目、原始录制、日志和截图在 `~/.local/novelive-tools/` 下，M1b/11 在 `m1b11-run/` 子目录；M4 抽查在对应 VM 的 `~/novelive-private/m4-spot/`。私有账本在 `~/memory/poke_5b9601/files/novelive/usage.csv`。原文与私有工件均不进 git。

## 已合入与未完成分支

- M0 已关闭。M1a/06 离线 W1–W3、M1b/09 离线闸门已合入，不能代替 M1a/07 真卷或 M1b/11 真跑。M2/08 [#57](https://github.com/Yume2333/Novelive-dev/pull/57) 已合入；`editor.resolveMark` 原先只返回 `not_found` 的空缺由 [#61](https://github.com/Yume2333/Novelive-dev/pull/61) 修复，main 合并提交 `91203f8`，[#63](https://github.com/Yume2333/Novelive-dev/pull/63) 补齐播放器标记渲染。M3/02 已合入 [#58](https://github.com/Yume2333/Novelive-dev/pull/58)。M4/10、M3/07 和 M5 发行验收未完成。
- **M1b/11**：`m1b-production/11-m1b-owner-book` @ `a0fe816`（[任务与脱敏收据分支](https://github.com/Yume2333/Novelive-dev/tree/m1b-production/11-m1b-owner-book/.workflow)）；`fix/sprite-alpha-requests` @ `d8415d6`。真实 Electron 已完成整卷预览、综合、主视觉确认、首章忠实度与演出。表情编辑两参考返回不透明，只移除不透明主视觉的对照 PNG 带 alpha（低于 16 的像素占 39.9%）；不改 FXB。代码默认先基准后画风，技术检查发现无 alpha 才只用透明基准重试一次，登记 `styleRefsDropped`，审核仍对照原参考；仍无 alpha 则暂停。离线两种结果有测试；严格检查 52 文件、654 通过、1 跳过。真实恢复到出图时按交接停止，0/7 发布，未观测到兜底触发，未试玩或手动继续。暂停是交接指令，不是本轮再次证实 alpha 错误。
- **M1a/07**：会话 `5526ea5a`，`devin/1795405418-m1a-w4-chunked`，[WIP #68](https://github.com/Yume2333/Novelive-dev/pull/68)，未合并。W4 三次整卷共识（37 条，留一 baseline 0.650，阈值仍是 0.90），三次整卷固定成 strict fixture；各批提示附已提出条目，抽取后按全卷尺度挑选，挑选结果设计上写入 checkpoint，恢复理应不再请求模型；实际重启零调用仍未验证。真实归一化从 0.28 到 0.80–0.85，310 条降到 58–78，`wen-suchen` 每次保留。未达阈值；缺 `chunked-run.json`，`m1a-w4-gate` 失败；无真实验收、重启零调用、CI 或 review。最后一稿（挑选带上已保留条目、关系改为长期关系）中途停止。接手：复跑该稿，对 `whole-runs.json` 用 `scoreAgainstConsensus`；修关系只有 0–1/5、地点城市前缀、术语遗漏、时间线/伏笔 10–12 条而基线约 7 条，仅改抽取和挑选，不改 scorer、阈值或 schema。达标写 `chunked-run.json`，按任务命令真跑并验证重启零请求，更新 `w4-metric.md`。该会话报 127 次 Gemini 调用、1,334,857 tokens、0 图；其 VM 的 5 个放大二进制测试因缺 Vulkan ICD。
- **M3/07**：`devin/1795413687-m3-gate` @ `55f9a1b`，[WIP #67](https://github.com/Yume2333/Novelive-dev/pull/67)，未合并。严格回放的 `M3 full playback` 在 Electron 与 Linux 非 ASAR AppImage 通过：存读档、语速、重启复位、镜头/特效恢复、跨章历史、多比例；放大已接线并登记档位，自定义标记截图已补录。CI 2/2；无付费、无缺档。先合 main，解决 `tests/unit/m1b-art.test.ts`（保留 main 的 `planArt` 测试与分支 `readProfiles` 断言），推送让因冲突跳过的 review 重跑；查手动启动「书库还是空的」是种子还是产品故障，再手测存读档、句中调速、重启、跨章历史；最后用 Linux Vulkan GPU 真测 1024px→2K 默认档热跑 P95（≤20 秒）及两次放大。llvmpipe 单次快档约 121 秒，不作 GPU 数据；M3 不含音频，恢复未验证。
- **M4/10**：会话 `3dce4199`，`devin/1795408423-m4-gate` @ `ce09ca4`，[WIP #66](https://github.com/Yume2333/Novelive-dev/pull/66)，未合并。至 `35a5e9e`：五格式导入、扫描 PDF 提示、EPUB/DOCX 手选插图最多 3 张、加入系列保留语言/设定、跨卷跨作品队列及全局重排、崩溃后暂停、单实例、持久事件回填已验证；gate 3/3、全量 e2e 57 通过，[真实 Electron 录屏](https://app.devin.ai/sessions/3dce4199f7e046978a8a99b27689ca37?testRecording=94625099-9fa9-4d96-8446-683bc018a71d)，前两轮 12 条 review 已修。第三轮返工：最早未确认卷才能打开视觉确认，后卷等确认后继承；旧工程已确认带图风格仍算批准；无效/过期表单报错。当前 typecheck 过，1 个集成测试失败，未跑 lint、gate、CI。先把关项目时等待者的原始 `AbortError` 变成 `{code:'cancelled'}`，关 DB 前 await 等待者，避免 `database is not open`；然后 typecheck/lint/test、严格 M4 gate、全量 e2e、CI 和 review；补测 ≥2 排队项重排、外图与内嵌图合计上限、选中 EPUB 插图保存。去掉 [WIP] 合入后再标完成。抽查 2 次、2,266 tokens、0 张生成图。

## 接手顺序（到完整 M5）

1. 本地核对 [交付队列](delivery-plan.md)、`bash .workflow/bin/workflow next` 与各分支最新头。对 checklist 完成但未归档的项先核对证据再归档（包括 M2/08、09 与已合入 M3/M4 前置），不要从 WIP 分支推断完成。
2. 离线并行处理 M4/10 的取消、重测及 review，以及 M3/07 的冲突、手测与 GPU W3；以 M4/10 合入和归档解锁 M5。M3 W3 未有 GPU 数据之前不签过关。Windows 本地放大需验证 `vcomp140.dll` 的供应/部署与干净机器加载；不能把缺运行库或 Vulkan 的 VM 失败记成通过。
3. 付费恢复前先合并/对账各会话账本并指定单一执行者。先按 M1a/07 新口径收敛到 0.90 与重启零调用，再关闭 M1b/11 的真书闸门。M1b 仍走整卷、复用预览、综合、主视觉、草稿、已审稿/演出和已有图片；只继续必要绘图，确认第一章、试玩、手动继续到后续发布，不以强制回放替代。剩余图片按保守计数最多 14，接近上限提前停。
4. M5/01 锁包契约；其后 M5/02 包编解码、03 存档迁移、04 分享 UI、05 打包更新、06 本地化可独立实施；02–05 齐后 07 共享接线。06/07 完成后才分发 08 Linux、09 Windows、10 macOS 同版本原生安装与离线播放/更新验收，三者齐后做 11 完整交付。只交本地未签名三平台安装包，不公开发布；图标、签名、更新源、译文抽检按规格留待确认。

## 停止时的用量快照

以本机私有账本汇总（包含失败、估算及预留），与其他 VM 的数不能直接相加；M1a/07 会话明细大于本机视图，M4 抽查也不在下面的本机总数里。对账前不宣称全局余额。

| 阶段 | 请求 | tokens | 生成图 |
| --- | ---: | ---: | ---: |
| M0/07、10、12 | 14 | 43,344 | 6 |
| M1a/07（本机） | 70 | 662,419 | 0 |
| M1b/02、03、08、10 | 37 | 233,373 | 13 |
| M1b/11（含一笔取消预留） | 231 | 1,286,604 / 20M | 26 / 40 |
| M2/03 与共享 | 17 | 50,391 | 0 |
| **本机合计** | **369** | **2,276,131** | **45** |

M1b/11 最后有 1 个已发送的在途请求被取消，尚无供应方结算；按 65,536 tokens、1 图上界保留。实际已计量部分为 230 次、1,221,068 tokens、25 图。中继已关闭。

## 运行注意

参考 [决策日志](decisions.md)。推理模型可能 HTTP 200 但耗尽输出仅有 reasoning；DeepSeek 中继可能忽略停用思考，JSON 角色可回退 Gemini，不把 200 当成成功。Linux 用仓库锁定 Node/pnpm 与支持 `--rename-dynamic-symbols` 的 patchelf，Electron E2E 用 Xvfb；Electron 安装目录若不完整先修安装，patched sharp 的 plain-Node 崩溃须和 CI 对照，Canvas 超时须区分启动抖动与真实回归。中文 UI 保持字体 token（VM 无系统 CJK 字体）。
