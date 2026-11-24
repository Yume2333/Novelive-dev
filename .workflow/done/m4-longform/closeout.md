# Closeout: m4-longform

**Accepted:** 2026-11-24 by agent (omp-vibe-windows)

The owner pre-authorized autonomous milestone delivery; all 10 tasks in `.workflow/done/m4-longform/` landed and passed closeout verification.

## Shipped

- **W1 (Import formats, EPUB fallback, scanned PDF, notes, manual illustration selection):**
  Verified in `tests/e2e/m4-gate.spec.ts` (`W1 five formats, EPUB fallback, notes, manual illustrations and scanned PDF` and `EPUB screening survives reopening and saves a manually overridden illustration`), `tests/e2e/m4-import-illustrations.spec.ts`, `tests/e2e/m4-epub-screening.spec.ts`, `tests/e2e/m4-import-join.spec.ts`, and unit suites (`m4-import-contract`, `m4-epub`, `m4-markdown`, `m4-docx`, `m4-pdf`, `m4-import-wizard`, `m4-import-join`, `m4-import-worker`). Five formats produce uniform `project.db`/volume/work structures, EPUB fallback chain & screening persistence work, notes are stripped into chapter notes, embedded + external reference limits and manual overrides persist, and scanned PDFs reject with the non-OCR prompt.
- **W2 (Multi-work queue, continuous series, slot yield/requeue/reorder, crash recovery, overrides, cross-language, stale-asset reminders):**
  Verified in `tests/e2e/m4-gate.spec.ts` (`W2–W3 continuous series, scheduling, crash recovery, waiting notifications and actual usage`), `tests/e2e/m4-production-queue.spec.ts`, `tests/e2e/m4-usage.spec.ts`, and integration/unit suites (`m4-series`, `m4-series-production`, `m4-queue`, `m4-usage-staleness`). Two-work + multi-volume production runs in strict replay Electron, confirms yield/requeue without preemption, drawer reordering works in both directions, `SIGKILL` recovery keeps works paused until explicit resume, series overrides and existing entries are preserved on join, English-source → `zh-CN` script compilation passes, and accepted Bible updates mark affected assets stale on the usage page.
- **W3 (Tray/no-tray lifecycle, background notification locate, reopen, power-save cleanup, actual usage panel):**
  Verified in `tests/e2e/m4-gate.spec.ts` (`W3 native quit drains the real creator and the same project resumes after reopening`, `W3 real host no-tray, tray reopen and same-profile second instance`, `W2–W3 continuous series...`), `tests/e2e/m4-tray.spec.ts`, and `tests/e2e/m4-single-instance.spec.ts`. Native Linux D-Bus/StatusNotifier/Dunst verification was previously recorded in [08-desktop-lifecycle.txt](../../evidence/m4-longform/08-desktop-lifecycle.txt). Closeout Electron proof confirms no-tray minimize, tray hide/reopen, same-profile single-instance focus, graceful creator drain on quit, `powerSaveBlocker` cleanup, notification click routing, and text/image usage ledger rendering.

### Closeout Proof

- `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M4 longform and queue' --workers=1 --reporter=list` → **5 passed (2.2m)** (`tests/e2e/m4-gate.spec.ts`, all 5 M4 gate tests).
- `NL_REPLAY=strict xvfb-run -a pnpm exec playwright test tests/e2e/m4-epub-screening.spec.ts tests/e2e/m4-import-illustrations.spec.ts tests/e2e/m4-import-join.spec.ts tests/e2e/m4-production-queue.spec.ts tests/e2e/m4-tray.spec.ts tests/e2e/m4-usage.spec.ts --workers=1 --timeout=60000 --reporter=list` → **10 passed, 2 skipped (22.5s)** (the 2 skipped require `NL_M4_NATIVE_HOST=tray|no-tray` with an isolated D-Bus/LXQt/Dunst session, separately recorded in `08-desktop-lifecycle.txt`).
- `NL_REPLAY=strict pnpm exec playwright test tests/e2e/m4-single-instance.spec.ts --workers=1 --reporter=list` → **1 passed (3.1s)** on `DISPLAY=:0` (XWayland + mutter; headless `xvfb-run` lacks a WM to grant `window.isFocused()`).
- `NL_REPLAY=strict pnpm exec vitest run --maxWorkers=2 tests/unit/m4-*.test.ts tests/integration/m4-*.test.ts` → **12 test files passed, 186 passed | 1 skipped (31.43s)** (`1 skipped` is the explicit opt-in `EPUB classification provider driver` in `tests/unit/m4-epub.test.ts`).

Evidence directory: `.workflow/evidence/m4-longform/` (`gate.txt`, `gate-resume.txt`, `review-fixes.txt`, `spot-check.txt`, `paid-smoke.txt`, `08-desktop-lifecycle.txt`, `09-usage-staleness.txt`, `gate-*.png`).

## Key decisions & plan changes

- Kept closeout verification in `NL_REPLAY=strict` using committed synthetic cassettes and cited the previously authorized paid spot check (`spot-check.txt`) and paid Electron smoke (`paid-smoke.txt`).
- Adapted `tests/e2e/m4-gate.spec.ts` `W3 real host no-tray, tray reopen and same-profile second instance` (`win.isMinimized()` on no-tray minimize under Electron 45 Linux, and `window.isVisible() && !window.isMinimized()` after second-instance restore when running headless without a window manager).

## Waived checks & skipped reviews

- No W1–W3 spec check was waived.
- Earlier M4 tasks (`02-epub-import.md`, `04-docx-import.md`, `05-pdf-import.md`, `08-tray-notifications.md`, `09-usage-and-staleness.md`) noted skipped local per-task reviews during initial authoring; all underlying PRs and subsequent gate/review follow-ups passed integration and gate verification (`PR #46`, `PR #48`, `PR #54`, `PR #66`, `PR #71`, and `.workflow/evidence/m4-longform/review-fixes.txt`).

## Remaining debt & follow-ups

- None for `m4-longform`. Package association registration remains scoped to `m5-delivery`.
