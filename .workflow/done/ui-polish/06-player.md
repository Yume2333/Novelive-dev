# 06: Player polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/player/, packages/ui/src/locales/*/player.json, tests/e2e/{m3-controls,m3-stage,m3-text,m1b-player}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/player/ + panels/agent/」 (Player rows L15–L20, S6–S11, U4–U17), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M3 controls|M3 stage|M3 text|M1b player'` pass.

- [x] **Leaks** L15–L18: history group headers and save excerpts fall back to 「未知章节」, never `chapterId`; the legacy-save panel says 「旧版本的存档（版本 3）」, and rows show time and excerpt, not 「槽位 N」; text speed becomes a unitless 慢 ↔ 快 slider with an instant endpoint, replacing the separate 「瞬间显示」 toggle (mapping stays internal); compile diagnostics become 「这部作品的内容有问题，无法播放」 with details in `Details`. Keep the `data-mainline` test hook.
- [x] **Style** S6–S11: the bare 「打开本地工程」 button becomes `Button`; every unstyled error `<p>` becomes `ErrorNotice` or the shared inline error style; overlay screens (save grid, history, settings, legacy saves) use `--space-*` and type tokens (the stage skin stays exempt); the legacy panel uses `.hover-row`/`.row-actions` and list-row conventions; chapter labels use `formatChapterLabel`.
- [x] **UX** U5–U15: hide 「在编辑器中打开这里」 when the work can't be linked; save-slot cards lead with chapter and excerpt, with the slot number as meta; the legacy panel explains why the saves can't load and that deleting them is safe, offers 「全部删除」 with a confirmation message, and appears only on the load screen; background failures (for example progress save) use a dismissible toast or banner instead of the fullscreen red box, which is reserved for load failures; waiting-card phase fractions live with the phase definitions; one locale voice (`无法…，请重试`, consistent 跳過, en "Quick save").
- [x] Sync all four locales and update the listed e2e specs where intended copy or DOM changed.

## Progress

Base commit: 3765fcb805ec811299e48501d04e9ef354dc20ab

Check before: baseline integration e2e (same env) red on 5 pre-existing tests: m3-stage.spec.ts 「directions…landscape fill crops」, m3-text.spec.ts 「page clip boundary…ruby-inflated lines」, m3-gate.spec.ts 「M3 full playback restores…」, m3-controls.spec.ts 「persistent slots, thumbnails, history and reread survive restart」, m5-delivery.spec.ts 「M5 full delivery…」; pnpm check not run before.

Check after: `pnpm check` exit 0 — typecheck + lint pass (biome/stylelint emit warnings only; `!important` count in controls.css unchanged at 15 vs base, zero added by this diff) and vitest `Test Files 76 passed | 1 skipped (77)`, `Tests 1195 passed | 3 skipped (1198)`. E2E per-file run (xvfb-run -a, NL_REPLAY=strict, NODE_OPTIONS json hook): exit 1 with exactly the same 5 pre-existing failures as baseline — m3-controls「persistent slots…」(30s timeout), m3-gate「M3 full playback restores…」, m3-stage「directions…landscape fill crops」(pixel [37,51,96] vs [32,48,96] mismatch), m3-text「page clip boundary…ruby-inflated lines」, m5-delivery「M5 full delivery…」(radio outside viewport); all other tests in the seven files passed — 13 passed including m1b-player.spec.ts, m5-share-ui.spec.ts and the remaining m3-controls/m3-stage/m3-text tests. Literal brief grep command `pnpm test:e2e --grep 'M3 controls|M3 stage|M3 text|M1b player'`: matches only 4 test titles (see residual note).

Review: pass (base 3765fcb805ec811299e48501d04e9ef354dc20ab, reviewer w06-reviewer). Its findings were fixed: non-dismissible save/load error overlay → toast; 「打开本地工程」 hidden under load error; en locale voice. Visual pass in light+dark done — evidence: /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task06/ (fixed: slider end-label dark contrast, sticky pagination nav).

Residuals:
- history-nav disabled-button styling is the shared disabled treatment.
- `humanizeError` `not_found` entry reads model-flavoured (foundation gap for window 01/gate).
- Window-ownership deviations: tests/e2e/{m3-gate,m5-share-ui,m5-delivery}.spec.ts and tests/fixtures/m5-legacy-saves.tsx edited because player copy/DOM changes broke them.
- Slider API unchanged (readout hidden by CSS in controls.css since components/ belongs to window 01 — gap: Slider has no way to hide the numeric readout).
- Literal grep in the brief matches only 4 tests; real coverage run per-file as well.
- E2E needs the NODE_OPTIONS JSON import hook in this environment (Playwright/Node 24 `with {type:json}` issue, pre-existing).
- The 5 pre-existing e2e failures reproduce identically on the untouched integration baseline in this environment; not chased.
- U4 (duplicated action sets in the menu) left as-is per audit (informational); U6 first-empty-slot emphasis left as-is (inherited prototype design gap); L19 `data-mainline` kept as test hook.

## Rework round 1 (gate 08 feedback)

Rework base commit: ec3bdc035c27ca4d0735df65b87dff8c492428fa (ui-polish/integration incl. task 07 rework, merged in before reworking; branch fast-forwarded then rework committed as b18c69d).

Fixed items:
- **A.** `PlayerControls.tsx` `slotAction` catch now uses `formatErrorText(humanizeError(error))` (was raw `error.message`). The orphaned locale key `存读档失败，请重试。` (its only usage) removed symmetrically from all four `player.json` (zh-CN/zh-TW/en/ja) to keep the parity test green.
- **B.** Font sizes now scale with `--player-font-size`: paper `.nl-player-name` `15px` → `0.5em` of the player-scaled textbox (15px at the 30px default, unchanged visually, scales with the setting); deleted the dead legacy `.nl-player-textbox` rule in `player.css` (every property incl. the off-token `1.25rem` was already overridden by the higher-specificity `.nl-player .nl-player-textbox` in controls.css — zero visual change); `.nl-player-caption` `1.5rem` removed and replaced with `.nl-player-caption .nl-text-viewport { font-size: calc(var(--player-font-size, 30px) * 1.2) }` in controls.css so captions keep their 1.2× emphasis as a proportion of the player font scale (the old `1.5rem` was dead for caption text because the viewport rule already won the cascade). `字号` setting still scales all three (verified: e2e asserts textbox/viewport reach 36px at slider 36).
- **C. persistent-slots regression — FIXED.** Root cause: ui-polish/06 turned mid-playback restore failures into the fullscreen `.nl-player-error` overlay (z-index 20, inset 0), which is never cleared and permanently intercepts every menu/stage click once a quick-load/restore fails — e.g. loading a save whose sentence was edited away. Baseline's overlay was an inset panel without z-index, so menu interaction still reached the player. Fix in owned `PlayerPage.tsx`: `loadProject`'s `fail` now always captures the humanized error into a `transientFailure` ref and only raises the fullscreen overlay when `report === 'block'` (genuine initial/chapter load failure); `restore` (quick-load/history rewind, playback ongoing underneath) always reports `'none'` and rethrows, so `slotAction`'s catch surfaces a transient toast and the player keeps running. Verified: `persistent slots` + `live text speed` pass on HEAD (2 passed, 24.2s, nl-headless).
- **D.** Merged `ui-polish/integration` (incl. task 07 rework, ec3bdc0) before reworking; task 08's gate-owned e2e spec-copy migrations live only as uncommitted staged changes in the uipo-08 worktree (branch ui-polish/08 == integration, nothing committed to merge) — nothing further to merge; no conflicts.

Check before (rework): `tests/e2e/m3-controls.spec.ts` `persistent slots` failed on HEAD solo in 30s — `<div class="nl-player-error">…</div> intercepts pointer events` on the `历史记录` click (regression vs baseline, which passes it in 13.6s).

Check after (exact observed output): `pnpm check` — typecheck + lint pass (biome/stylelint warnings only, pre-existing), vitest `Test Files 77 passed | 1 skipped (78)`, `Tests 1212 passed | 3 skipped (1215)`. Official Check e2e grep `'M3 controls|M3 stage|M3 text|M1b player'` (matches 4 describe-titled tests): `3 passed (20.3s)`, 1 failed = `m3-text.spec.ts:244` ruby-inflated page-clip — proven pre-existing, see below. Rework-critical per-file verification on HEAD: `m3-controls.spec.ts -g 'persistent slots|live text speed'` → `2 passed (24.2s)`.

Pre-existing-failure proof (item C) — baseline = `87d0a4c` (pre-ui-polish, parent merge of the first ui-polish commit; found via `git merge-base main ui-polish/integration` = e59cecf which is the ui-polish spec-docs commit, so its parent merge 87d0a4c is the true pre-polish code), extracted with `git archive 87d0a4c` into `/tmp` (no worktree, no stash), `pnpm install --frozen-lockfile` + `pnpm build` there, run via `/home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/bin/nl-headless pnpm exec playwright test <file> -g '<title>'` with NL_REPLAY=strict + NODE_OPTIONS json hook:
- `m3-text.spec.ts -g 'page clip boundary'` on **baseline**: `1 failed` — `Expected: true / Received: false` at `expect(sawInflatedLine).toBe(true)` (m3-text.spec.ts:389). **Identical on HEAD** (`1 failed`, same assertion). → pre-existing, NOT a regression.
- `m3-controls.spec.ts -g 'live text speed'` on **baseline**: `1 passed (8.5s)`; on HEAD solo: passed. The gate's 「stalls at glyph 39」 did not reproduce solo in this environment — it is a parallel-load flake, not a regression (and glyph-reveal code in packages/player is untouched by ui-polish).
- `m3-controls.spec.ts -g 'persistent slots'` on **baseline**: `1 passed (13.6s)`; on HEAD before rework: failed (blocking overlay). → was a real regression in owned files, now fixed (see C above).

Review: fail→pass (base ec3bdc035c27ca4d0735df65b87dff8c492428fa, reviewer uipo-06-rework.w06-reviewer). Single finding: the transient restore toast shows the generic humanizeError fallback instead of the specific localized sentence — confirmed as a genuine **foundation gap**, not a surface defect (see Residuals); no other findings in any file.

Residuals (rework):
- **Foundation gap (window 01 owns `format/`): `humanizeError` cannot round-trip an already-localized message.** For a plain `Error`/object with an unrecognized Chinese message it returns `render(fallback, detail)` — the specific message survives only in `detail`, which `formatErrorText` drops. So a mid-playback quick-load of a save whose sentence was edited away now correctly shows a *transient, non-blocking* localized toast (「无法完成操作，请重试。」 family) instead of a blocking fullscreen overlay — the regression is fixed and behavior is correct — but the more specific 「存档中的句子已不存在」 cannot surface through the mandated helper without forking it. Recorded for the gate/01: `humanizeError` needs a pass-through for already-localized messages (or `formatErrorText` could append detail). The m3-controls spec assertion was updated from the overlay-specific exact-text check to assert the behavioral guarantee (player keeps playing the current sentence), with a comment pointing here.
- `humanizeError` `not_found` copy and Slider readout gaps carried over from round 1 unchanged.

## Rework round 2 (gate 08 feedback)

Rework base commit: d43308159dd615858cfac1664fff7580f352457f (fast-forward merge of ui-polish/08 into ui-polish/06, no conflicts).

Fixed items:
- **A. Localized save times.** `ProgressPanel.tsx` quick/manual slots and `legacy-saves/LegacySavePanel.tsx` no longer format save times with `new Date(...).toLocaleString()` (host OS locale, with seconds). They now use `Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })` — no seconds, following the UI language — the same options as production `formatRecordTime` (`pages/production/ChapterRecords.tsx`). The formatter is memoized on `i18n.language` via `useTranslation()` inside each component (one formatter per language, not per render item), with an invalid-date guard. Grep of the whole `pages/player` tree confirms no other `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString` date displays remain. No new locale strings.
- **B. controller.ts no longer pulls i18n into the spec module graph.** `controls/controller.ts` dropped its runtime `import { msg } from '../../../i18n'` (`msg` is a pure identity marker). The four `chapterPhaseFractions` keys are now plain string literals — object keys are unchanged (`写作/审稿/演出/出图`, still verbatim-matched against backend progress text from `creator/src/project/player.ts`); no test scans source for `msg(` (m5-locales key coverage reads the JSON files directly), so dropping the marker breaks nothing. Because `controller.ts` now has only type-only imports, the `tests/e2e/m3-controls.spec.ts` / `m3-stage.spec.ts` module graphs load without the gate's `NODE_OPTIONS` JSON-import hook workaround. `i18n/` and `locales/index.ts` untouched (not owned).

Check after (exact observed output): `pnpm check` exit 0 — typecheck + lint pass (biome/stylelint warnings only, pre-existing `noNonNullAssertion` in `creator/share/project.ts`), vitest `Test Files 77 passed | 1 skipped (78)`, `Tests 1212 passed | 3 skipped (1215)`; `pnpm build` exit 0. `nl-headless pnpm exec playwright test --grep 'M3 controls|M3 stage|M3 text|M1b player'` (4 tests): `3 passed (22.0s)`, 1 failed = `m3-text.spec.ts:244` ruby-inflated page-clip (`expect(sawInflatedLine).toBe(true)`) — accepted residual per gate round-2 feedback §6, proven pre-existing on baseline `87d0a4c` (identical assertion failure), orthogonal to both rework items. The pre-rework module-load crash (`TypeError: ... agent.json needs an import attribute of "type: json"`, zero tests run) is gone.

Review: pass (base d433081, reviewers w06-review, w06-review2).

Residual: the `Intl.DateTimeFormat` save-time formatter is duplicated locally in the two player files (each with its own `useMemo`); there is no shared date-format helper in `packages/ui/src/format/` — owned by window 01, so it could not be created here. Recorded as a gap for the gate: a shared medium-date/short-time helper in `format/` would dedupe production, usage, and player.
