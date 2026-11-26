# Closeout: ui-polish

**Accepted:** 2026-11-26 by agent (omp-vibe-windows)

The owner pre-authorized autonomous delivery; no separate sign-off was sought.

## Shipped

- **01 foundation** — contract error kinds (`issueKinds`, `importErrorCodes`, structured production `issue`/`errorKind`/`failureKind`), the `packages/ui/src/format/` layer (chapter/paragraph/volume/scene labels, path collapse, cost, work titles, asset labels, humanized errors), shared `ErrorNotice`/`LoadingState`/`Details`/`ButtonLink` components, integer font-size tokens, the `format` i18n namespace across all four locales.
- **02 shell/global pages** — shell interruption strip on shared `Banner`+`Button`, welcome/library/usage/settings polished; config/unreadable-project errors localized via machine enums; absolute paths home-collapsed.
- **03 authoring pages** — import wizard (join-mode read-only 系列, localized error sentences), work/confirm/production pages; chapter records with humanized failure kinds; first-page confirm flow copy.
- **04 editor** — humanized hunk ordinals, first-chapter fallback (no `ch0001` literal), leak-free diff/alert presentation, eyebrow `seriesTitle · formatVolumeLabel` matching production/confirm/bible.
- **05 bible** — curated field rendering replacing the generic dump, locale-safe slider units, character detail polish.
- **06 player** — player controls and menus polished, `ErrorNotice` migration, NVS-line humanizer, app-locale save timestamps.
- **07 agent panel** — tool display registry (localized titles + curated rows, raw payloads only inside `Details`), subtask labels from backend task text, session-recency menu, localized chrome.
- **08 gate** — leak sweep (0 FIX NEEDED), before/after audit of all 14 surfaces in light+dark, three verification/rework rounds, Linux AppImage rebuilt and smoke-launched on the final revision.

## Verification

- Final revision `13052fe`: `NL_REPLAY=strict pnpm check` → typecheck 0 errors, lint 0 errors, `Test Files 77 passed | 1 skipped (78)`, `Tests 1218 passed | 3 skipped (1221)`; `pnpm build` exit 0.
- Targeted e2e under nl-headless (14 specs covering rework changes) — 48 tests, 47 passed, 1 failed (m4-gate W3 minimize, accepted residual: Xvfb has no window manager).
- Audit: `.workflow/evidence/ui-polish/audit.md` — per-surface matrix across three capture rounds, every research-note high/medium finding either verified-fixed in captures or accepted-residual with reason; round-3 recapture confirms the editor eyebrow fix (`纸船与灯火 · 第 1 卷`) and usage banner localization visually.
- AppImage `apps/desktop/dist/linux-x64-y5PXJ5/artifacts/Novelive-0.0.0-linux-x86_64.AppImage` (525,765,205 bytes, SHA-256 `d5e3ad5e9865227df2d5f8cd6aa868bb9a4554b96a5aad36a7b87cbdcfaeb490`) smoke-launched in isolated HOME under nl-headless — alive ≥15s, empty-library state painted.
- Reviews: rework round-1 and round-2 verification reviews plus the full-diff landing review (all in `/home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task08/`) — landing verdict **SHIP**, no blocking/major findings.

## Key decisions & plan changes

- Three rework rounds: round 1 sent gaps back to 02/03/04/06/07 surface owners instead of patching their folders in the gate; round 2 (5 owner-targeted items) verified 13 FIXED + 1 PARTIAL by independent reviewer, with the PARTIAL plus review nits closed by gate fixes in `13052fe`.
- Machine-enum migration for backend error reasons (config, unreadable projects, scheduler failure kinds) — the UI never regexes zh-CN strings; legacy rows classify through `legacyFailureKind`/`normalizeSubtask` fallbacks.
- Player phase keys in `controller.ts` deliberately stay un-`msg()`-wrapped identifiers matching backend zh-CN source strings; extraction unaffected because the same keys are `msg()`-collected in `PlayerControls.tsx`.

## Waived checks & skipped reviews

- No spec check was waived. The owner pre-authorized autonomous delivery.
- Accepted residuals (13, enumerated in `audit.md`): custom-mark slug as banner title, bible glossary overflow-x, no 保留 action on stale assets, no live run-records for in-flight steps, English model output inside bible values, plus five environmental/pre-existing e2e flakes (Xvfb no-WM minimize, gvfs trash, ruby page-clip, import-illustrations teardown, single-instance focus) — each reproduced on the pre-polish baseline or environment-explained.

## Remaining debt & follow-ups

- 13 follow-up items at `/home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/followups.md` — all MINOR, none affecting the shipping surface: legacy run-record `errorKind` fallback, `shareErrorCodes` literal duplication, NULL-meta defensive parse, DOCX dead error code, TXT fallback mis-classification, pre-existing-on-main editor draft/effect-deps/double-fetch items, two test-assertion nits, a cosmetic path-collapse inconsistency, bespoke read-only field markup, and the Xvfb minimize harness limitation.
- Join-mode read-only 系列 field never visually captured (would need invented fixtures); covered by the `m4-import-join` e2e assertion instead.
- Landed onto main by gate 08 (merge of ui-polish/integration).
