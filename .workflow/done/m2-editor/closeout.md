# Closeout: m2-editor

**Accepted:** 2026-11-24 by agent (omp-vibe-windows)

The owner pre-authorized autonomous delivery; no separate sign-off was sought.

## Shipped

- W1: real-Electron edits of lines, text effects, expressions, bible and terms;
  persistent edit history across reopen, session-scoped undo, two-way
  source↔script navigation and preview-from-current-line. Editor undo stack
  now survives partial rewrites via backend rebase, and the UI mirrors the
  surviving entries exactly from `editor.snapshot` `undoLines`.
- W2: streaming chat with attachments, stop, branching and compaction;
  unconfirmed proposals never apply, rejections return reasons, and stale
  proposals cannot overwrite newer content.
- W3: both editor and Agent entry points rewrite and apply only the checked
  diffs; single-image redraw dispatches `novelive:asset-changed` so the open
  editor re-resolves the asset instead of reopening; chapter rules are frozen
  per production run (write captures fresh, review/stage/budget-resume reuse
  them) so rules affect only not-yet-started work.

## Verification

- `pnpm typecheck` clean; `pnpm lint` 2 pre-existing warnings (unrelated
  share/project.ts non-null assertion).
- Unit: `vitest tests/unit/m2-* tests/unit/m5-locales` → 9 files / 114 passed.
- E2E: all 15 m2 specs passed under `NL_REPLAY=strict` (m2-bible, m2-chat,
  m2-contract-routes, m2-editor, m2-gate `1 passed` 17.7s each).
- The earlier preview-pixel failure was root-caused to M3 `clipViewport`
  clipping the canvas under the opaque textbox (the small editor stage leaves
  only a thin visible strip); fixed by software-GL launch flags matching the
  m3 specs and sampling inside the visible strip — no product change, the
  textbox-overlap clip is intended.

## Key decisions & plan changes

- Added `editor.snapshot` (returns chapter + settings + settingsRevision +
  `undoLines`) so a chapter-changed refresh and the post-rewrite and
  mark-accept paths can resync an open session without a full editor reopen.
- `sceneAssets` includes carried-over stage assets and `@hide` treats
  left|center|right as slot names regardless of occupancy; `lineExpression`
  gates expression editing to a single occupied-slot match and excludes
  pending assets.
- History/rules surfaced via two drawers (`EditorPanels`) instead of a modal;
  UI uses Tokens and `ScrollArea` only.

## Waived checks & skipped reviews

- No spec check was waived. The owner pre-authorized autonomous delivery.
- Task 08 passed independent read-only review (`w01-reviewer-m2`,
  2026-11-24, window 01): the blocking finding (scene rewrites reusing frozen
  per-run rules, so saved rules never reached later rewrites — a W3
  violation) was fixed by capturing fresh rules per rewrite call without
  touching the run's `frozenRules`; the history-drawer raw enum/JSON display
  and per-render `lineExpression` compile were also fixed.

## Remaining debt & follow-ups

- The same `clipViewport` clip affects other workers' preview pixel tests
  (m3-stage, m1b-player) — owning worker is `w01-m3m5-archive`.
- No paid calls were made during the gate; recording stayed within the
  committed m2-gate cassette.
