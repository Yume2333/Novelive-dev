# Closeout: prototype-parity

**Accepted:** 2026-11-24 by agent (omp-vibe-windows)

The owner pre-authorized autonomous delivery; no separate sign-off was sought.

## Shipped

- W1: `NL_REPLAY=strict pnpm check` green on the integrated branch (typecheck,
  biome, stylelint, vitest 1086 passed).
- W2: `pnpm build` and offline Electron entry-point checks pass; existing
  authoring and playback routes remain reachable.
- W3: every reference surface in `prototype/src/` was compared at matching
  viewports in both themes with reference/result screenshot pairs and per-page
  residual-difference audits under
  [`.workflow/evidence/prototype-parity/`](../../evidence/prototype-parity/).
- W4: shell navigation, Agent overlay, editor preview and player menus verified
  on the real Electron path; no native scrollbar or content-obscuring layout
  regression.

## Key fixes in the integrated revision

- Merged PR #110 head `9171564a31` plus `094d32dd8f` and `c6e1c3a16d`; the five
  integrated-review checklist items were audited and fixed:
  - editor sentence list with 高级模式 mark chips and inline span editor;
  - Bible structured character/glossary detail;
  - ConfirmFirstPage 960px layout with real scene cards and 进编辑器修改;
  - `library.list` series/volume hierarchy on work, production and confirm;
  - player soft banner scrim and pill styling.
- Second-round independent visual review: PASS on 2026-11-24. One non-blocking
  finding (index-keyed mark drafts going stale after span edits) was fixed by
  clearing the draft maps on every sentence text rewrite in `SentenceList.tsx`.

## Verification

- Electron e2e green on a 1920x1080 display: prototype, m0-shell, m0-ui-shell,
  m1b-creation-ui, m1b-wizard, m2-editor, m2-bible, m2-chat, m2-gate,
  m3-controls, m3-stage, m3-custom-marks, m3-gate, m5-share-ui, m5-locales.
- m3-text ruby-inflated fails identically on the integration baseline
  (pre-existing; not caused by this effort).

## Remaining debt & follow-ups

- m3-text ruby-inflated baseline failure tracked under m3-playback.
- No paid calls were made during this effort.
