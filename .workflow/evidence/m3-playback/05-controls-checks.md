# M3 player controls verification

## Commands and result excerpts

`pnpm typecheck` (exit 0)

```text
$ tsc --noEmit
```

`pnpm lint` (exit 0; existing unrelated fixture diagnostic retained)

```text
$ biome check && stylelint 'packages/ui/src/**/*.css'
tests/fixtures/text-models/build-synthetic.ts:63:3 lint/style/useTemplate  FIXABLE
Checked 291 files in 164ms. No fixes applied.
Found 1 info.
```

Six-finding review round, before adding the explicit-load freshness regression:

`NL_REPLAY=strict pnpm test tests/integration/m3-save.test.ts tests/unit/m1b-player.test.ts tests/unit/player-progress-ipc.test.ts` (exit 0)

```text
Test Files  3 passed (3)
Tests       20 passed (20)
```

Latest explicit-load/save-mode review round:

`NL_REPLAY=strict pnpm test tests/integration/m3-save.test.ts tests/unit/player-progress-ipc.test.ts` (exit 0)

```text
Test Files  2 passed (2)
Tests       13 passed (13)
```

`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 player controls'` (exit 0)

```text
Running 5 tests using 1 worker
  ✓ persistent slots, thumbnails, history and reread survive restart
  ✓ controller uses contract dwell and never skips unread or a wait
  ✓ settings and reread in the real Electron player
  ✓ chapter wait in the real Electron player
  ✓ reread successor in the real Electron player
  5 passed (19.7s)
```

`NL_REPLAY=strict xvfb-run -a pnpm exec playwright test tests/e2e/m1b-player.spec.ts` (exit 0)

```text
Running 2 tests using 1 worker
  ✓ M1b minimal player renders local compiled beats and advances all four text kinds
  ✓ M1b minimal player renders local compiled beats and advances all four text kinds and reports a missing referenced asset
  2 passed (4.0s)
```

## Real-window evidence

`05-controls-menu.png`: inspected the rendered Chinese DOM system menu in the real Electron player. E2E exercises Esc/right-click, settings/fullscreen, hide/restore, reread/mainline, editor navigation, chapter publication/auto-load/click gate, and waiting DOM event entry/exit.

`05-controls-saves.png`: real Electron manual-slot grid, thumbnail and timestamp. The test captures the stage without the menu at 480×270, verifies quick load stops auto/skip playback, restarts with the same user-data directory, restores a manual slot and exercises history backward/forward across chapters. Reread leaves the persisted mainline unchanged.

Notification delivery itself belongs to M4/08; this change emits `novelive:player-waiting` with work ID on entry and null on exit/unmount. No preload/main notification hook is added.

## Review and limitations

Devin Review findings on `91e7841` were addressed in separate commits:

- `7389335`: missing persisted resume sentences fall back to the chapter start.
- `9002779`: history restores select playback mode from the target chapter, including returning from reread to mainline.
- `e9d7758`: validate saved/history positions before committing history changes or replacing the mounted stage; invalid saves leave the existing player usable.
- `dd8bd24`: snapshots capture displayed restored text, including after the underlying script changes.
- `b0863f7`: load-dialog initial focus skips disabled controls, including entirely empty grids.
- `6b60c68`: history requests no thumbnails; grid requests share validated cached progress, refreshed on writes. Unit coverage checks 60 concurrent requests, empty slots, untrusted senders and corrupt persisted data.
- `b8be259`: explicit progress loads always read the store, so another app instance's newer progress/saves are not replaced by cached data when reopening playback. No `requestSingleInstanceLock` exists in the desktop entry point or the app/packages/tools source; thumbnail requests still share cached metadata.
- `4a7330b`: save restores keep the mode selected by `PlaybackProgress.loadSave`; only history jumps derive mode from the target chapter. Electron regression checks a read off-mainline save loads in main mode, while TOC reread still uses reread mode.

Real Electron coverage includes stale resume IDs after restart, history reread → mainline with subsequent forward progress, invalid save rejection without losing stage/history, and re-saving an old-text snapshot after an actual scene rewrite.

The initial implementation skipped independent workflow review because no reviewer-spawning tool was available; independent workflow/security review is still needed at effort close. Read/mainline and saves persist using M3/04; settings and session history remain in memory. The minimal snapshot renderer restores background, sprites and dialogue text, not the full stage's camera/effects/audio or interrupted animations. No paid calls or replay cassette changes were needed.

## M3/03 merge integration

Merged `origin/main` at `3c57712` without rebasing. M3/03's `text/` source is unchanged. `createPlayback` keeps `textFinished` fifth and takes `{ startIndex }` sixth. Minimal-player clicks first go through `mountText.click()`, preserving page completion and scripted `cont` holds. Snapshot text remains the content actually mounted, including old text restored after a script edit, and restarts at page one.

Live speed uses `millisecondsPerCharacter`; a speed change remounts the displayed sentence at page one because M3/03 exposes construction-time options, not an update hook. Scripted completion follows the replacement renderer. Native scripted-auto multiplier uses the reciprocal of the controls multiplier, translating M3/03's divisor into the contract's `(1200 + 80 × page characters) × multiplier`. Font size consumes the existing CSS variable on the new viewport; opacity/style remain on the dialogue box via CSS variables/data attributes.

The controller observes text page/reveal metadata, not beat identity; direct rendered-beat reporting remains authoritative for textless beats and chapter completion. Page glyph geometry determines page character counts and complete reveal. Final-page readiness also waits for `finished`, preserving trailing pauses. Skip-read routes clicks through every page of a read sentence and stops before advancing unread text.

Requested strict Electron commands (exit 0):

```text
NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 player controls'
Running 6 tests using 1 worker
6 passed (28.6s)

NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M1b minimal player'
Running 2 tests using 1 worker
2 passed (5.9s)

NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 text typography'
Running 2 tests using 1 worker
2 passed (16.8s)
```

Relevant Vitest coverage: save integration, M3 contract and progress IPC suites passed (19 tests); the loader/playback suite passed (9 tests). The corrected restored-start test uses the fixture's single paragraph and checks the fifth completion hook alongside sixth-argument restore, completion errors and abort. M3/03's timing units live in its Playwright spec and ran above.

```text
NL_REPLAY=strict pnpm test tests/unit/m1b-player.test.ts
Test Files  1 passed (1)
Tests  9 passed (9)

pnpm typecheck
$ tsc --noEmit

pnpm lint
Checked 316 files in 133ms. No fixes applied.
Found 1 info.

bash .workflow/bin/workflow validate
Workflow is valid (66 task files).
```

`git diff --check` and `git diff origin/main --check` exit 0. The extra cached-diff check against the pre-merge branch reports whitespace in incoming PDF fixture xref rows; those files match main and were not edited (stripping PDF whitespace would invalidate offsets).

Real-window `05-controls-pages.png` was inspected: the multi-page read sentence has been skipped page-by-page, and the next unread sentence remains at page one. The same test verifies visible 153 ms/grapheme typing, instant speed, autoplay waiting for page reveal, page dwell and page-two quick save restoring at page one. Existing menu/save-grid evidence and the M1b screenshot were refreshed by their regression tests.

## Review on merge `edadb6bf612533028930037d0ba618815c336d0a`

- `3d7452c`: hide the overlay with opacity, retaining visibility and layout. Explicit glyph visibility cannot override ancestor opacity. The real-window hidden state was inspected in `05-controls-hidden.png`; clicking and keyboard restoration remain covered.
- `79f838e` and `396ad2a`: read scripted-auto text is eligible for skip, using M3/03's unchanged `mountText(..., { skip: true })`. This completes read `cont`/caption sentences without typing, pauses or dwell. The controller rechecks the live read state when executing a queued skip, so a timer from a previous read sentence cannot skip the newly displayed unread sentence. Native auto timing remains authoritative when not skipping. Click-driven read sentences still traverse their pages.
- `496908a`: the unrevealed-page regression waits past the 300 ms contracted dwell while the scheduled timer remains live, asserts no advance, then invokes cleanup.

Checks after the last code edit (exit 0):

```text
NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 player controls'
Running 7 tests using 1 worker
7 passed (35.0s)

NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 text typography'
Running 2 tests using 1 worker
2 passed (16.9s)

pnpm typecheck
$ tsc --noEmit

pnpm lint
Checked 316 files in 216ms. No fixes applied.
Found 1 info.
```

Lint's only informational diagnostic remains the unrelated `useTemplate` suggestion in `tests/fixtures/text-models/build-synthetic.ts`. `git diff --check` and `git diff origin/main --check` exit 0. The new read-auto Electron case seeds three read sentence IDs, skips both `cont` and caption text containing 60-second initial/trailing pauses, and verifies the first unread auto sentence stays at zero revealed glyphs. No text-layer source or API changes.
