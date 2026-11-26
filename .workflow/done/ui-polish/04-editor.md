# 04: Editor polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/editor/, packages/ui/src/locales/*/editor.json, tests/e2e/{m2-editor,m3-custom-marks}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/editor/ + pages/bible/」 (Editor rows, S1–S4, U6–U10), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor|M3 custom marks'` pass.

- [x] **Leaks** L1–L14: the stage footer, expression picks, and cast badges use `formatAssetLabel` with one separator; the mark-proposal banner shows a styled sample (CSS only in `Details`); rewrite hunks are labeled `第 N 处` with sentence ordinals, and NVS directives are humanized (`原文第 1–5 段`, asset names) or moved into `Details`; history entries render through `parseSentenceLines` + `RichText` with no `#lineId`, `cont`, or raw asset keys; the default instruction uses `原文第 7 段`; the source panel has no per-paragraph `p0001 ·` and uses a `原文第 1–5 段` range; scene and chapter select fallbacks use ordinals; the panel title 「NVS 剧本」 becomes 「剧本文本」 in all locales; the jump menu strips tails; one shared speaker display-name helper; compile diagnostics are humanized and rendered with preserved line breaks.
- [x] **Style** S1–S4: `EmptyState`/`LoadingState` replace `editor-empty`/`editor-muted`; delete the dead CSS blocks (`.editor-banner`, `.editor-button*`, `.editor-icon-button*`, `.editor-chip`); one mark-insertion control style (shared `Chip`/`Button`) in both modes; type tokens replace fractional sizes.
- [x] **UX** U6–U10: drop the per-card 「有原文对照」/「连播」 chip noise (keep the information only where it is actionable, with plain wording); reword save errors so they never mention IDs; make undo discoverable on every history entry or state clearly which one it applies to.
- [x] Sync all four locales and update the listed e2e specs where intended copy or DOM changed.

## Progress

- Base commit: 3765fcb805ec811299e48501d04e9ef354dc20ab
- Check after: `NL_REPLAY=strict pnpm check` exit 0 (Test Files 76 passed | 1 skipped (77); Tests 1195 passed | 3 skipped (1198)); `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor|M3 custom marks'`: 10 passed / 0 failed, run twice consecutively (27.8s, 28.1s).
- Review: pass (base 3765fcb, reviewer R-reviewer-04)

### Rework (gate 08)

- Rework item: `EditorPage.tsx` `params.get('chapterId') ?? 'ch0001'` hardcoded an internal id as fallback.
- Fix: `chapterId` is now `chapterIdParam ?? workChapters?.[0]?.chapterId` — no param falls back to the first chapter once `production.playerStatus` arrives; the `editor.open` and chapter-changed-listener effects bail out while the id is unresolved; when the loaded work has no chapters (and no deep link) the page shows the shared `EmptyState` (「这部作品还没有章节」, added to all four locales); loading otherwise uses `LoadingState` as before. A `playerStatus` failure with no deep link now surfaces an honest `ErrorNotice` instead of a fake empty state. No `ch0001` remains anywhere in `packages/ui/src` (grep clean). No unit test depended on the old fallback; the e2e specs already pass explicit `chapterId` params, and the contract fixture gained `library.list`/`production.playerStatus` handlers plus two new modes covering the new behavior: `firstchapter` (no param → opens the first chapter, asserts `editor.open` fired exactly once with the first chapter id and no `ch0001` in the DOM) and `nochapters` (empty work → shared EmptyState, `editor.open` never fired).
- Rework base commit: 7f6938607279e010942e5f0743ef27c0d5a4c62b
- Check after: `NL_REPLAY=strict pnpm check` exit 0 (Test Files 77 passed | 1 skipped (78); Tests 1212 passed | 3 skipped (1215)); `pnpm build` exit 0 (built in 5.29s); `nl-headless pnpm exec playwright test tests/e2e/m2-editor.spec.ts tests/e2e/m3-custom-marks.spec.ts`: 12 passed / 0 failed (30.1s) — the same 12 tests the `--grep 'M2 editor|M3 custom marks'` filter selects (verified via `--list`).
- Unrelated baseline failure (proof): the exact command `pnpm exec playwright test --grep 'M2 editor|M3 custom marks'` fails at collection on the integration baseline before running any test: `TypeError: Module ".../packages/ui/src/locales/en/agent.json" needs an import attribute of "type: json"` (exit 1, 0 tests run). Root cause is task 06's e184fa8 adding `import { msg } from '../../../i18n'` to `packages/ui/src/pages/player/controls/controller.ts`, which `tests/e2e/m3-controls.spec.ts` imports statically; playwright enumerates every spec in `tests/e2e`, so node ESM hits the bare json imports in `packages/ui/src/locales/index.ts`. Proof it is not this rework: enumeration succeeds with the identical tree when only `m3-controls.spec.ts` is absent (`--list` shows exactly the 12 tests above, my modified `m2-editor.spec.ts` included); none of my changed files are in the failing import chain. Reported to Main for task 01/06 ownership.
- Review: pass (base 7f69386, self-review — small diff, reviewer step optional per rework brief)

### Rework round 2 (gate 08)

- Rework item: the editor eyebrow rendered `纸船与灯火 · 纸船与灯火` because import writes the same title into series and work.
- Fix: `EditorPage.tsx` composes the eyebrow like production/confirm/bible — `seriesTitle · formatVolumeLabel({ index: volumeIndex })` (bible-style `[...].filter(Boolean).join(' · ')`, no copy added); package works (no project) keep the work title; state renamed `workTitle` → `workEyebrow`.
- Rework round 2 base commit: d43308159dd615858cfac1664fff7580f352457f
- Check after: `NL_REPLAY=strict pnpm check` exit 0 (Test Files 77 passed | 1 skipped (78); Tests 1212 passed | 3 skipped (1215)); `pnpm build` exit 0; playwright with gate JSON hook (Node 24 JSON-import workaround, same as gate 08) `nl-headless pnpm exec playwright test --grep 'M2 editor|M3 custom marks'`: 12 passed / 0 failed (36.1s).
- Review: pass (base d43308159dd615858cfac1664fff7580f352457f, reviewer w04-review)

### Residuals

- Rewrite-modal screenshot not captured (needs model worker; covered by contract-fixture e2e).
- Dark-theme low-contrast secondary text is a global palette matter (not editor-specific).
- humanizeDiagnostics passthrough can still echo hand-typed NVS grammar parameter names in advanced-mode compile errors (accepted).
- `高级模式` toggle is a styled button with aria-pressed because Chip does not forward aria-pressed (gap for task 01/gate).
- m2-editor fixed-project test sanitizes WAYLAND_DISPLAY/XDG_SESSION_TYPE/ozone hint env to get DPR 1 under xvfb on Wayland hosts.
- Screenshots at /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task04/ (12 images, light+dark).
