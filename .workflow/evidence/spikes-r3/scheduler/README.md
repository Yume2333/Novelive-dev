# scheduler（R3 任务队列与出图队列：持久化与调度 fuzz）

验证内容：M1a 制作调度的数据库设计与规则——`schema.sql` 五张表（`work` 单槽/`task` 意图/`task_dep` 软硬依赖/`asset` 出图队列实体一行终身/`chapter` 用户态），`scheduler.mjs` 调度核心（dispatch/finish/stopAll/resume/confirm/retryTask/onFinalFailure/input_hash 核对），`sim.mjs` 确定性 fuzz（mulberry32，假 worker 随机失败/审核拒绝/崩溃重开），`unit.mjs` 15 条规则单测，`live.mjs` 活性检查（无故障必到 done、静默态无悬挂、不重复执行）。fuzz 逼出并修掉 9 个真 bug（redo 死锁、asset 唯一约束、chapter_failed 暂停被 stop 覆盖等）。支撑报告 `.workflow/research/refs/ext-2026-11-r3-scheduler.md`。

文件：`schema.sql`（DDL 可直接并 M1a project.db）、`scheduler.mjs`（~430 行 node:sqlite 核心）、`sim.mjs`/`unit.mjs`/`live.mjs`（fuzz/单测/活性）、`fuzz{2000,3000,4000,_final}.log`+`live{free,faulty}.log`（各轮结果：unit 15/15 PASS、live 2000 seeds 0 违例、sim 末轮 2000 seeds×400 步 0 违例）。**归档时 `node sim.mjs 2000 400` 仍在跑**（`fuzz_final.log` 已含 DONE 行 0 violations，进程未等退出即拷）。

重跑：`node unit.mjs`（15 条规则）→ `node sim.mjs 4000 400`（4000 seed×400 步 fuzz）→ `node live.mjs free`/`node live.mjs faulty`（活性）；`schema.sql` 用 `node:sqlite` `DatabaseSync` 直接 exec 建库。

第三方依赖：Node ≥22（`node:sqlite`，实测 v24.18.0），无 npm 包。
