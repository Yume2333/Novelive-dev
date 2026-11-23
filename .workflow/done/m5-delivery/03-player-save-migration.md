# 03: 实现更新时存档与已读迁移

**Effort:** m5-delivery
**Blocked by:** 01
**Covers:** W2
**Files:** packages/player/src/progress/migrations/, apps/desktop/src/save-data/index.ts, tests/integration/m5-saves.test.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-saves.test.ts` → 现有数据目录真实迁移、缺句子和章节时旧槽保留且可删；迁移后写入新槽触发清理时，旧槽的缩略图仍可读取，无引用的缩略图被清除。
**Base commit:** e10725ed62a8c41308a373b35d1a7fc6d92aa5cb

- [x] 保持作品 ID、场景/句子 ID 与已读；老快照字段补默认，不把存档写入包。
- [x] 桌面存档清理同时保留当前槽和旧版本存档组引用的缩略图，只清除没有存档引用的缩略图。

## Progress

- 只在应用数据目录迁移；同章节、场景与句子 ID 的存档和已读记录保留。主线落点不存在时取原章节首句，再退到全作首句；无句子时清空主线。不能匹配的槽按来源版本归档。
- 同 ID 存档从新版每章初始舞台重放到目标句，更新台词和舞台状态，不沿用旧版素材。
- 接线：更新确认后由 M5/07 调用 `FileProgressStore.migrate({ workId, fromVersion, toVersion, chapters })`（`chapters` 按播放顺序列出每章经 `toPlaybackBeats` 转换的节拍）；旧槽用 `loadLegacySaves`、`thumbnail` 和 `deleteLegacySave`。分享编解码、界面和更新确认不在本任务范围。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m5-saves.test.ts` → `Test Files  1 passed (1)` / `Tests  2 passed (2)`；见 `.workflow/evidence/m5-delivery/03-save-migration.txt`。
- Real path: 两次启动 Electron，验证已有应用数据目录中的槽可迁移、480×270 WebP 可解码、旧槽与无引用缩略图可删除。不调用付费接口。
- Review: skipped — 当前子会话没有独立审查执行入口，交由主会话执行 PR 审查。
