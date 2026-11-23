# M2 chat strict replay

`cassette.jsonl` contains synthetic OpenAI Completions SSE responses, with
request identities from the real pi chat loop. It covers multimodal streaming
(also replayed with a mid-stream stop), summary and branch context, human
proposal decisions, and isolated child context. No provider traffic is needed:

```sh
NL_REPLAY=strict pnpm exec vitest run tests/unit/m2-chat.test.ts
```

The authorized coordinator can use `record.ts` for provider evidence, with the
relay credentials and private `NL_CASSETTE_DIR` and `NL_USAGE_CSV` paths outside
the repository. Run
via `NL_REPLAY=record pnpm --filter @novelive/desktop exec tsx ../../tests/fixtures/cassettes/m2-chat/record.ts`.
Do not replace the deterministic regression fixture with a private recording.
