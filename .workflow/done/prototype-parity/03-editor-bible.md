# 03: Restore editor and bible

**Effort:** prototype-parity
**Blocked by:** None
**Files:** packages/ui/src/pages/editor/, bible/
**Read first:** .workflow/specs/prototype-parity.md, DESIGN.md, prototype/src/
**Check:** `NL_REPLAY=strict pnpm check` passes; real Electron entry point matches the corresponding prototype with screenshot evidence.
**Covers:** W1, W2, W3

- [x] Compare every assigned page directly with prototype.
- [x] Preserve real data and current working interactions.
- [x] Capture matched-viewport reference/result evidence and record residual differences.

## Progress

- Implemented in PR #112 (`devin/1795418600-editor-bible-parity`): prototype header, chapter and scene pickers, square icon toolbar, a prototype-sized stage with the scaled real preview, the bible rail/list/detail layout, the glossary table, and a candidates panel closed by default.
- Check after: `pnpm typecheck` and `pnpm build` pass with shell commit 2a59120 applied. These strict-replay E2E specs pass: m2-editor, m2-bible, m2-chat, m3-custom-marks, m4-usage, m1b-creation-ui and m2-contract-routes. m4-gate W1 and m3-controls player tests failed with `database is locked` or player timing errors in code this PR does not touch; each is noted with its rerun result in the PR.
- Evidence: `.workflow/evidence/prototype-parity/editor-bible/` (light and dark reference/result pairs at matched viewports, plus `audit.md` with the residual differences).
- Review: skipped — parent fresh integration review pending. Devin Review findings on the PR were triaged (13 resolved, 1 rejected).
