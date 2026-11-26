# 所有者回来要看的事

无人值守期间，等所有者决定的事和 agent 自己定下的重要选择都记在这里。所有者看过一条就删一条。

## 等所有者决定

- **正式仓库**：建在哪另议；在那之前不发公开 Release。自动更新已接好：定了之后把 `apps/desktop/package.json` 的 `updateRepository` 填成 `owner/repo`，推送 `v<version>` tag 即由 **Release** 工作流构建三平台并直接发布（仓库不是 `Yume2333/Novelive-dev` 时另配 `NL_RELEASE_TOKEN`），见 `docs/architecture.md`「本地交付与更新复验」。

## 付费账本对账

见 [`.workflow/evidence/usage-ledger/README.md`](evidence/usage-ledger/README.md)：并入 M1a/07 W4（`w4-run-usage.csv`）与 M1b/11 `live-run-2026-11-24`（w1/w2/w3）后，共享台账累计 **15,700,249 已核销 tokens / 350 张图**，另有 **12,931,481 未核销 tokens / 232 张图预留位**（含历史未归因差额与 M1b `live-run-2026-11-24` 未返回的 210 个已放弃预留位；共 **1,018 次有逐窗记录的调用，不含未分窗计数的 `m1b-2026-11-24` w1–w3**），合并名义敞口 **28,631,730 tokens / 582 图位**。按全项目 **20 亿（2B）tokens、500 张图**硬上限：仅计已核销余量为 **1,984,299,751 tokens、150 张图**；若把未核销已放弃预留并入敞口则为 **1,971,368,270 tokens、−82 图位**（不代表当前授权继续付费）。

## 已关闭事项的遗留说明

- **M1b/11 零占位补绘（`done` 带残余风险）**：`m1b-production` 已在所有者指示下于 2026-11-24 验收关闭（[spec](specs/m1b-production.md)、[closeout](done/m1b-production/closeout.md)）：《浮生六記》1 卷 4 章已全部制作发布并在真实 Electron 试玩；89 个素材中仍有 29 个占位（第 1–3 章 `placeholder=1`），唯一阻塞为上游生图端点返回 HTTP 503 `insufficient balance`（外部计费原因）。所有者为 relay 充值后可用同一私有项目继续补绘并完成 ch1–4 零占位复验。
- **前端 #110 原型对齐与 M1a/07 W4、M3/07 W3 均已验收解决并归档**：见 [`done/prototype-parity/closeout.md`](done/prototype-parity/closeout.md)、[`done/m1a-project/closeout.md`](done/m1a-project/closeout.md)（W4 归一化 `0.929653` ≥ 0.90）、[`done/m3-playback/closeout.md`](done/m3-playback/closeout.md)（RTX 4060 Linux Vulkan 预热 P95 = 8.405s ≤ 20s）。

## 交接时按默认做的（2026-11-21，所有者没有异议）

- 剧本指令全集和语法表由 agent 在 M1a 定稿。
- 质量评测集由 agent 标注。
- 某章生成失败时整部作品暂停，重试成功后恢复。
- 修改历史持久保存，撤销只在本次打开内有效。
- 注册 `.novelive` 文件关联；新版本替换旧版时，旧包进回收站。
- 放大用可随包分发的二次元模型，不依赖 NVIDIA 显卡（后已定 `upscayl-bin` + `realesrgan-x4plus-anime`，M3 用真图复比）。
- 其余逐项默认值见 `research/handoff-defaults.md`。

## agent 自己定下的选择

<!-- 格式：- <日期> <effort/NN>：<选了什么>（见 decisions.md <标题>） -->
- 2026-11-20：`创作端运行在 Electron utility process`，放大降噪子进程走标准输入输出（见 `decisions.md` 2026-11-20「创作端单独开后台进程，Python 走标准输入输出」；放大程序后已改为 ncnn-vulkan 二进制）
- 2026-11-21：放大默认用 `upscayl-bin` + `realesrgan-x4plus-anime`（快速档 `realesr-animevideov3`），M3 用真图复比（见 `decisions.md` 2026-11-21「放大默认用 Real-ESRGAN 动漫模型」）
- 2026-11-21：第三轮实测后的 8 项架构定案（设定集素材登记表、CG 带造型/地点参考图与审核比对、构图数值检查+视觉审核 5 项、美术导演默认读整章、错误按响应体 error code 分类、五表调度+图片失败不暂停、不用 chardet、剔除原书注释）（见 `decisions.md` 2026-11-21「第三轮实测后的取舍（按证据定）」）
- 2026-11-21：`draw_image { content }` 工具拼装提示词并查禁词，画师只写内容段，删掉 `negativePrompt` 与 `Avoid:` 行（见 `decisions.md` 2026-11-21「生图提示词由工具拼装，画师只写内容段」）
- 2026-11-22：补记 7 项未写明的取代关系，并将画风参考三组对比实验推迟到 M1b 出图时执行（见 `decisions.md` 2026-11-22「补记未写明的取代关系」）
- 2026-11-23 m2-editor/01：冻结带修订版本的编辑、重写和会话契约（见 `decisions.md`「编辑与会话共用版本化契约」）。
- 2026-11-23 m2-editor/04：设定/术语以内容哈希保守判过期，复用 proposal/asset 表，跨章定位为派生字段（见 `decisions.md`「设定候选复用提议表与内容修订」）。
