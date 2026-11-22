# 07: 移植创作界面与确认点

**Effort:** m1b-production
**Blocked by:** 01
**Covers:** W1, W2
**Files:** packages/ui/src/pages/production/, packages/ui/src/pages/work/, packages/ui/src/pages/confirm/, packages/ui/src/pages/settings/production/, tests/e2e/m1b-creation-ui.spec.ts
**Read first:** `.workflow/specs/m1b-production.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M1b creation surfaces'` → 用合成投影显示制作状态、两次确认、失败再试和高级设置。
**Base commit:** f1a0090eba860b4f86937b57b09c7ab9f246b4ac

- [x] 连接第一卷角色、三份主视觉、已发布/需要处理、运行记录、写手及角色模型配置；UI 固定契约后独立。

## Progress

- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M1b creation surfaces'` 通过（2 项）；`NL_REPLAY=strict pnpm check` 通过（213 项）。
- Real path: 构建后的 Electron 打开作品和制作界面，用合成投影验证两个确认点、章节记录和失败恢复；用真实创作端验证高级设置重载后保留。VNC 未报告悬停能力，未验证鼠标悬停；真实制作到首次试玩留给 M1b 集成验收，无需本任务录制付费模型。
- Evidence: `.workflow/evidence/m1b-production/07-production-surfaces.txt`、同目录的 `07-first-chapter-gate.png` 和 `07-writer-settings.png`。
- Review: pass (base f1a0090eba860b4f86937b57b09c7ab9f246b4ac, reviewer pr-review-job-5c058b99083743bcac9b22060f39e335)
