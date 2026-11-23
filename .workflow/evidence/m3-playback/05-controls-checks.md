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
Checked 289 files in 185ms. No fixes applied.
Found 1 info.
```

`NL_REPLAY=strict pnpm test tests/integration/m3-save.test.ts tests/unit/m1b-player.test.ts` (exit 0)

```text
Test Files  2 passed (2)
Tests       16 passed (16)
```

After rebasing onto the newly merged M4/08 startup, the affected loader/IPC suite was rerun (`NL_REPLAY=strict pnpm test tests/unit/m1b-player.test.ts`, exit 0):

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 player controls'` (exit 0)

```text
Running 5 tests using 1 worker
  ✓ persistent slots, thumbnails, history and reread survive restart
  ✓ controller uses contract dwell and never skips unread or a wait
  ✓ settings and reread in the real Electron player
  ✓ chapter wait in the real Electron player
  ✓ reread successor in the real Electron player
  5 passed (17.1s)
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

Review skipped: no independent reviewer/subagent spawning tool is available in this session. An independent workflow/security review is still needed at effort close. Read/mainline and saves now persist using M3/04; settings and session history remain in memory. The minimal snapshot renderer restores background, sprites and dialogue text, not the full stage's camera/effects/audio or interrupted animations. No paid calls or replay cassette changes were needed.
