# Closeout: m1a-project

**Accepted:** 2026-11-24 by agent (omp-vibe-windows)

The owner pre-authorized autonomous milestone delivery; all 7 tasks in `.workflow/done/m1a-project/` landed and passed closeout verification.

## Shipped

- **W1 (工程包与磁盘 schema):**
  `packages/format` 定义六类数据契约（pi-schema + `project.db`/SQLite），工程目录保留身份、源文、表和任务记录；暂停并重开真实项目文件不丢失。验证于 `tests/unit/m1a-project-schema.test.ts` 等单元套件。
- **W2 (TXT 边界用例与剧本解析):**
  `packages/creator` 的 TXT 检测、卷/章划分、清洗、编码歧义处理、附注剥离、场景/行 ID 与诊断经 `tests/unit/m1a-txt.test.ts`、`tests/unit/m1a-script.test.ts` 等验证。
- **W3 (合成多卷导入→预览→综合严格回放):**
  `prepareVolume` 磁盘工程含原文、章段落、导入报告、分卷摘要、骨架、候选与术语表；候选冲突不覆盖已确认条目；长卷断点续跑保留已应用补丁，重开零请求且结果一致。验证于 `tests/integration/m1a-project.test.ts`、`tests/unit/m1a-owner-book-resume.test.ts`、`tests/unit/m1a-consolidate.test.ts`、`tests/unit/m1a-synthesis.test.ts` 等。
- **W4 (所有者选书真卷比较验收):**
  公版《野叟曝言》（维基文库 `oldid=2523154`，20 卷 / 154 回）实导入，首卷「奮字卷之一」7 回做整卷↔分块对照。参照为三次整卷多数共识（37 条非时间线）+ 原书引用段落重建的 7 条时间线（`tests/fixtures/m1a-owner-book/timeline-reference.json`，仅脱敏出处指针入库），共 44 条；留一基线 `0.649884`。付费实跑 `run-2026-11-25-v5`（5 包 / 11 事件）：`shared 29 / chunked 52`，原始 F1 `0.604167`，**归一化 `0.929653` ≥ 0.90**；`confirmedIntact: true`（文素臣保留）、`restartRequests: 0`、`restartIntact: true`。评分器 `tests/acceptance/bible-patch-score.ts` 与 0.90 门槛未改动。证据与口径：`.workflow/evidence/m1a/owner/{w4-metric.md,receipt.txt,chunked-run.json,w4-consensus.json,usage.csv,w4-run-usage.csv}`。

### Closeout Proof

- `NL_REPLAY=record pnpm exec vitest run tests/acceptance/m1a-owner-book.test.ts` → **1 passed (673.12s)**（`run-2026-11-25-v5`，日志 `/tmp/w4-paid-v5.log`；红acted结果 `w4-consensus.json`）。
- `NL_REPLAY=strict pnpm vitest run tests/unit/m1a-w4-gate.test.ts` → **4 passed, 0 skipped**（离线核验已发布分块结果对重建参照 ≥ 0.90 归一化、44 条参照构成、证据无密钥、证据与 fixture 逐字节一致）。
- `NL_REPLAY=strict pnpm vitest run tests/unit/` → **54 test files passed, 914 passed | 1 skipped**。
- `NL_REPLAY=strict pnpm typecheck` → exit 0；`NL_REPLAY=strict pnpm lint` → exit 0（仅既往 warning/info）。
- `.workflow/bin/workflow validate` → valid（69 task files）。

窗口付费用量：256 次调用、2,513,130 tokens、0 张图（上限 5,000,000；`.workflow/evidence/m1a/owner/w4-run-usage.csv` 为逐行脱敏账本，Window 09 归并）。

## Key decisions & plan changes

- 时间线参照按所有者批准方案从原书引用段落重建（`timeline-reference.json` 存 SHA-256/偏移指针，不存原书整段）；留一基线诚实保留 `whole-runs.json` 三次真实整卷输出（不覆写时间线），经 `scoreOwnerBookAgainstReference`（`tests/acceptance/owner-book-reference.ts`）评分。
- 产品修复（非 scorer 变通）：`consolidate.ts` `reconcileNamedAdditions` 解除 `protectedIds` 阻塞跨回归并并支持共享唯一别名单向归并；`canonicalize.ts` 保留短 `location.variants` 别名归并；`patch.ts` 修复合并时清空首条 `location`/`relation` 描述；`preview`/`synthesis` 新增 `preserveSourceWording` 引导保留原文措辞与全名；`Relation` 回归简短常驻类别；文本适配器将推理耗尽无答案响应标为 `reasoning_limit`。
- 预览模型按实跑可用性从 DeepSeek 回退 `gemini-3.8-flash`（DeepSeek 推理耗尽探针见 `receipt.txt`），综合保持 `devin-swe-2`；不更改产品默认模型。

## Waived checks & skipped reviews

- 无 W1–W4 检查被豁免。
- 07（W4 spike）记录 `Review: skipped`（无独立审查会话）；付费证据、门禁与账本已在仓库内复核。

## Remaining debt & follow-ups

- 无 `m1a-project` 遗留。私有书源（`~/novelive-testbooks/`）、运行目录（`~/.local/novelive-tools/m1a-owner-book/`）与私有账本（`~/novelive-private/usage-w4.csv`）按规则保留在仓库外；`w4-run-usage.csv` 由 Window 09 并入 `.workflow/evidence/usage-ledger/`。
