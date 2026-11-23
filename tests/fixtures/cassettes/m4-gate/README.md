# M4 synthetic longform gate

These are authored, deterministic synthetic responses and generated images,
not provider recordings or evidence of model/art quality. `author.ts` passes
an in-process responder to the production service and cannot call a provider.
The source books are tiny original fixture prose in `fixture.ts`.

Regenerate from the repository root:

```sh
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m4-gate/author.ts
```

UUID normalization includes response rebinding for joined chapter IDs. All
chapter-two writing uses the normal `devin-swe-2` model, with no failure/recovery
model switch. The Electron gate consumes only committed strict replay entries.

The gate enables response rebinding with `NL_REPLAY_REBIND_IDS=1`. Without that
opt-in, existing replay responses are unchanged. Headless host checks control
tray-watcher availability and intercept native notification `show()`; they use
the actual tray click handlers, native window transitions, creator process and
renderer/preload IPC. OS notification bubbles and model quality are not tested.
