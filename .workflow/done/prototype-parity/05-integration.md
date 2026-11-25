# 05: Verify integrated prototype parity

**Effort:** prototype-parity
**Blocked by:** 01, 02, 03, 04
**Files:** tests/e2e/, .workflow/evidence/prototype-parity/
**Read first:** .workflow/specs/prototype-parity.md, DESIGN.md, prototype/src/
**Check:** `NL_REPLAY=strict pnpm check` passes; real Electron entry point matches the corresponding prototype with screenshot evidence.
**Covers:** W1, W2, W3, W4

- [x] Compare every assigned page directly with prototype.
- [x] Preserve real data and current working interactions.
- [x] Capture matched-viewport reference/result evidence and record residual differences.

## Progress

- Review: blocked (base c7b30eb8beb07f87343cb993cb7827c80fa62ee0, reviewer devin-f62c44a85d344e78aaf554cffbe53512)
- The first independent visual review found seven blocking parity gaps. All four area sessions are fixing one combined batch; the final integrated revision and replacement receipts require the second and final review round before landing.
- Strict offline check on ce4c00a passed (68 test files, 1073 tests; one file and three tests skipped). Build passed. Onboarding preserves independent model providers, selected production chapter routing reaches the player, and import/share flows use the prototype-aligned controls.
- The editor now reads its chapter catalog through the existing read-only player status command, avoiding production-session initialization. Final full Electron checks and UI-driven acceptance remain pending after all area fixes are integrated.
- Merged PR #110 head `9171564a31` plus `094d32dd8f` and `c6e1c3a16d`. Checklist items 1–5 audited and fixed: editor sentence list with 高级模式 mark editor, Bible structured detail, ConfirmFirstPage 960 layout with real scene cards and 进编辑器修改, `library.list` series/volume hierarchy on work/production/confirm pages, player soft banner scrim and pill fixes.
- Check after: `NL_REPLAY=strict pnpm check` green. Electron e2e green on a 1920x1080 display: prototype, m0-shell, m0-ui-shell, m1b-creation-ui, m1b-wizard, m2-editor, m2-bible, m2-chat, m2-gate, m3-controls, m3-stage, m3-custom-marks, m3-gate, m5-share-ui, m5-locales; m3-text ruby-inflated fails identically on the integration baseline. Evidence in `.workflow/evidence/prototype-parity/`.
- Review: pass — second-round independent review PASS on 2026-11-24; one non-blocking mark-draft finding fixed by clearing index-keyed mark drafts on every sentence text rewrite in `SentenceList.tsx`.
