# text-pipeline（R3 文本流水线：预览→分卷→综合→写→审→修→演出）

验证内容：文档定的 creator 文本管线在《骆驼祥子》24 章 138k 字上端到端跑通：逐章预览（smol 并发 8）、分卷建议、按卷综合出 bible/glossary/skeleton、写手写 ch01/02/23 剧本、忠实度检查（quote 代码核验 9/9）、问题场退回修复、美术导演整章 vs 分批对比（整章格式合规+省 4.1× input）、三档改编强度（faithful/balanced/lean 句长上限）。「恰一次覆盖」靠提示词显式验收句 + `src/nvs.py coverage_report` 机检。支撑报告 `.workflow/research/refs/ext-2026-11-r3-text-pipeline.md`。

文件：`src/{common,nvs}.py`（TXT 规范化+pNNNN 段号+k 表 token 估算+.nvs 机械解析/覆盖/标签校验）、`prompts/`（9 份 v1 提示词 + writer-strength 三占位版）、`work/usage.jsonl`（52 条调用级 token 账本，成本重算用）、`out/`（`bible.json` 52 角色/42 地点、`glossary.json` 66 条、`skeleton.json` 4 卷、`chNN.images.json` 图清单、`grammar-draft.md` M1a 语法表底稿、`ch01.balanced-v2.nvs` 定稿格式样本、`ch23.first-scene.nvs` 首场景样本；其余 `.nvs` 与 `out/strength/` 是近逐字书文未拷）、`REPORT-notes.md` 未拷（已并入报告）。`work/source/`（章原文）、`work/{chapters,volumes,preview,synthesis}`、`out/*.nvs` 主体未拷——书文规则。

重跑：需自备书文 TXT（公版《骆驼祥子》wikisource 可拉），`NL_BOOK=<txt路径> NL_TP_ROOT=<本目录> python3 src/common.py` 规范出 `work/source/chNN.txt`，再按 `prompts/` 各角色提示词跑 eval completion（smol=预览、default=写审修演）；产物落 `out/`、账本 `work/usage.jsonl`；诊断 `python3 src/nvs.py <nvs文件>`。

第三方依赖：无 npm/pip 包（纯 stdlib python3 + eval completion/judge）；书文自备。
