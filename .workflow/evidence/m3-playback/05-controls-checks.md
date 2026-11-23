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
Checked 291 files in 145ms. No fixes applied.
Found 1 info.
```

`NL_REPLAY=strict pnpm test tests/integration/m3-save.test.ts tests/unit/m1b-player.test.ts tests/unit/player-progress-ipc.test.ts` (exit 0)

```text
Test Files  3 passed (3)
Tests       20 passed (20)
```

`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 player controls'` (exit 0)

```text
Running 5 tests using 1 worker
  ✓ persistent slots, thumbnails, history and reread survive restart
  ✓ controller uses contract dwell and never skips unread or a wait
  ✓ settings and reread in the real Electron player
  ✓ chapter wait in the real Electron player
  ✓ reread successor in the real Electron player
  5 passed (19.0s)
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

Real Electron coverage includes stale resume IDs after restart, history reread → mainline with subsequent forward progress, invalid save rejection without losing stage/history, and re-saving an old-text snapshot after an actual scene rewrite.

The initial implementation skipped independent workflow review because no reviewer-spawning tool was available; independent workflow/security review is still needed at effort close. Read/mainline and saves persist using M3/04; settings and session history remain in memory. The minimal snapshot renderer restores background, sprites and dialogue text, not the full stage's camera/effects/audio or interrupted animations. No paid calls or replay cassette changes were needed.
