# M2/09 写手自定义标记验收

## 真实写手录制（私有）

使用合成英文原文和写手的正式章节适配提示，仅调用一次 `gemini-3.8-flash`：445 输入、1,683 输出，共 2,128 tokens；0 次生图。模型返回一场 NVS 和 `lantern-glow` 提议（`text-shadow: 0 0 6px violet;`，逐字），解析后提议与剧本分离。随后用 `NL_REPLAY=strict` 重放同一私有 cassette，零上游调用，得到同一个提议。原始录制未入库。

## Electron 严格回放

使用公开的合成 M1b gate fixture，走真实写手任务、SQLite、creator IPC 和编辑器。在确认点 2 打开第一章，横幅直接显示两个候选；接受逐字标记后它才出现在文本标记菜单，拒绝另一项后它从横幅消失且从未进入菜单。重开编辑会话验证作品设置只保留已接受标记。覆盖截图：[待确认](09-pending-marks.png)、[已处理](09-resolved-marks.png)。

版本回归测试另验证：旧版本接受、旧版本拒绝均返回 `stale_revision`；用当前版本再次处理已移除候选返回 `not_found`。
