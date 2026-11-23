# 08: 验收编辑与对话的组合流程

**Effort:** m2-editor
**Blocked by:** 04, 05, 06, 07
**Covers:** W1, W2, W3
**Files:** packages/creator/src/entry.ts, packages/ui/src/App.tsx, packages/ui/src/shell/, tests/e2e/m2-gate.spec.ts, .workflow/evidence/m2/
**Read first:** `.workflow/specs/m2-editor.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M2 revise a work'` → 真实 Electron 从脚本定位原文，分别经两个入口重写，重开验证持久记录。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 接线并比对原型，CJK 文本效果和最小播放器预览保留；严格回放，不新增付费调用。

## Progress

Status: blocked

- 仅等录制：已接线五个 `editor.*` 命令，真实宿主的 editor / Agent 共用生产会话的 `CreativeRevisions`；重绘候选复制到应用缓存。新增编辑导航、Agent 场景位置、确认后的逐项勾选应用及编辑器刷新。当前后端始终返回空 `markSuggestions`，故 `resolveMark` 校验章节版本后返回 `not_found`，不捏造不存在的建议。
- `M2 revise a work` 已在真实 Electron 严格离线走到首次 Agent 模型请求：原文定位、最小播放器、编辑入口只应用勾选差异、Agent 加载及中文按钮均已验证。缺档为 `POST 139b150a39b3ef23 (tests/fixtures/cassettes/m2-gate)`。确认卡、Agent 重写、中文代码块和重开持久化的断言已写好，但录制前不声称通过；复选框保留未完成。现有 `m2-chat` 不含 `propose_rewrite_scene`，不替代本门禁。
- 主线在仓库根目录绑定已有 relay secrets `NL_IMAGE_BASE_URL` / `NL_IMAGE_API_KEY` 后，仅需运行：

  ```sh
  mkdir -p "$HOME/novelive-private/m2-gate"
  NL_REPLAY=record \
  NL_CHAT_CASSETTE_DIR="$HOME/novelive-private/m2-gate" \
  NL_USAGE_CSV="$HOME/novelive-private/usage.csv" \
  xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'
  ```

- 预计新增 **3 次** `gemini-3.8-flash` OpenAI chat-completion 调用：Agent 提议（含中文代码块）、确认后的 writing 重写、main 续答；均通过真实宿主配置，12000 context / 1024 max output / compat auto。初次 editor 重写严格复用 M2/07 cassette，不花费调用。数量为正常路径预期，不是硬性预算；模型额外工具调用或重试会增加次数。避免以 `deepseek/devin-swe-2` 录制新的聊天（可能耗尽输出于 reasoning）。本会话未进行真实录制或模型网络调用。
- 私有 cassette 为 `$HOME/novelive-private/m2-gate/cassette.jsonl` 及可选 `cassette-files/`，每个真实请求前追加私有 usage CSV；不提交。离线复验用同一目录并将 `NL_REPLAY` 改为 `strict`，不需 secrets。默认提交目录 `tests/fixtures/cassettes/m2-gate/` 目前仅放操作说明；截图、严格失败输出和短回执提交在 `.workflow/evidence/m2/`。录制完整通过后再补 Agent 中文代码块及重开截图、验收并勾选。
- 检查：`NL_REPLAY=strict pnpm check` → 29 files / 393 tests passed；后续 UI 调整后 typecheck / lint 通过；既有 editor / chat / routes Electron 检查 12 passed。回执见 `.workflow/evidence/m2/receipt.md`，现有三张截图为原文与预览、编辑器勾选差异和 Agent 加载状态。
