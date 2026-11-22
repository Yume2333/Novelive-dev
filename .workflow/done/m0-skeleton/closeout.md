# Closeout: m0-skeleton

**Acceptance pending:** W5 independent prototype review and milestone review.
The owner pre-authorized autonomous delivery on 2026-11-22, so no separate
owner sign-off is required. This does not waive the independent W5 check.
The spec remains `in progress` until that review is recorded.

## Shipped

- W1/W2: frozen install, 129 unit tests and 13 Xvfb Electron E2E checks passed.
- W3: the merged live recording was audited in M0/10. The gate reverified
  restart persistence and all committed W3 success and error results by strict
  Electron replay, without repeating the paid calls.
- W4: strict browser smoke and fault runs, HTTP thumbnails, terminal logs,
  restart and a successful test after switching back to smoke passed.
- W5: captured same-viewport comparisons and fixed mismatches in the empty
  library and Settings image editor. Independent acceptance remains pending.
- W6: inserting a CSS hex literal failed with its location; removal restored
  the green check.
- W7: the GitHub Actions Linux job passed frozen install, `pnpm check` and a
  real Xvfb Electron SQLite/sharp smoke.

[Local and Electron receipts](../../evidence/m0/gate/11-local-checks.txt) ·
[Browser receipts](../../evidence/m0/gate/11-browser-checks.txt) ·
[Prototype comparison](../../evidence/m0/gate/11-prototype-comparison.md) ·
[CI receipt](../../evidence/m0/gate/11-linux-ci.txt)

## Key decisions & plan changes

- Kept gate execution in strict replay and cited the existing W3 paid run.
- Pinned and verified patchelf 0.19.3 for CI: 0.18.0 corrupts the patched sharp
  binary in this build.
- Preserved the intentional M0 omissions documented in the W5 comparison.

## Waived checks & skipped reviews

- No spec check was waived. No separate owner sign-off is required.
- Independent review remains unrecorded for M0/01–07, 09–12 where noted in
  task Progress; include those skipped reviews in the milestone review.

## Remaining debt & follow-ups

- Run the independent W5 and milestone review, archive M0/11, record acceptance
  and mark the spec done. M1a starts with the shared project/SQLite contract.
- No paid calls were made during the gate.
