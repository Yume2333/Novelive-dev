# Volume synthesis replay

These cassettes contain synthetic SSE responses to test the synthesis code, not
provider recordings or evidence of real-book quality. The author supplies an
in-process upstream with no network transport:

```sh
pnpm exec tsx tests/fixtures/cassettes/m1a-synthesis/author.ts
NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-synthesis.test.ts
```

For a disk smoke test, run `run.ts <new-project-path> whole`, then run
`run.ts <different-new-project-path> checkpoint`, `resume`, and `reopen` against
the second path in separate `pnpm exec tsx` processes. All runs use strict replay.

`synthesizeVolume` normally chooses whole or event extraction based on its context
budget. M1a/07 can force `strategy: 'whole'` and `strategy: 'events'` against
separate copies of the same approved volume, then compare the returned
`biblePatch` by normalized identity and operation. Do not use this synthetic
fixture for the W4 quality comparison.
