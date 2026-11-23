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
Checked 255 files in 114ms. No fixes applied.
Found 1 info.
```

`pnpm test tests/unit/m1b-player.test.ts` (exit 0)

```text
Test Files  1 passed (1)
Tests       5 passed
```

`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 player controls'` (exit 0)

```text
Running 3 tests using 1 worker
  ✓ controller uses contract dwell and never skips unread or a wait
  ✓ settings and reread in the real Electron player
  ✓ chapter wait in the real Electron player
  3 passed (8.1s)
```

`NL_REPLAY=strict xvfb-run -a pnpm exec playwright test tests/e2e/m1b-player.spec.ts` (exit 0)

```text
Running 2 tests using 1 worker
  ✓ M1b minimal player renders local compiled beats and advances all four text kinds
  ✓ M1b minimal player renders local compiled beats and advances all four text kinds and reports a missing referenced asset
  2 passed (3.8s)
```

## Real-window evidence

`05-controls-menu.png`: inspected the rendered Chinese DOM system menu in the real Electron player. E2E exercises Esc/right-click, settings/fullscreen, hide/restore, reread/mainline, editor navigation, chapter publication/auto-load/click gate, and waiting DOM event entry/exit.

Notification delivery itself belongs to M4/08; this change emits `novelive:player-waiting` with work ID on entry and null on exit/unmount. No preload/main notification hook is added.

## Review and limitations

Review skipped: no independent reviewer/subagent spawning tool is available in this session. An independent workflow/security review is still needed at effort close. Settings and progress are in-memory; durable progress integration belongs to the parallel task. No paid calls or replay cassette changes were needed.
