# Synthetic preview replay

All prose and SSE responses here are authored synthetic fixtures, not provider
recordings or evidence of model quality. The M0 `text-models/synthetic` fixtures
and synthetic moderation cassette establish this convention; decisions permit
synthetic M1a unit inputs while real-book quality acceptance remains separate.

`fixture.ts` supplies two volumes and three fictional chapters. `author.ts`
rebuilds request hashes with the existing replay recorder against an in-process
SSE responder only; it cannot access the network. It includes successful preview
and digest responses, one schema repair, repeated invalid JSON and token-limit
termination. No credentials or paid model calls are needed.

Regenerate from the repository root with:

```sh
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m1a-preview/author.ts
```

Real disk/service entry-point smoke (use a new persistent project path):

```sh
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m1a-preview/run.ts "$HOME/preview-smoke/project" create
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m1a-preview/run.ts "$HOME/preview-smoke/project" reopen
```

The unit tests only replay committed cassettes in strict mode. Missing requests
fail closed. Provider behavior and real-book summary quality are not evaluated.
