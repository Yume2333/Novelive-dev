# M1b/03 synthetic image and art replay

The committed cassette is synthetic. The author uses an in-process HTTP
responder and Sharp-generated PNGs; it cannot call any provider. It covers
director staging, main visual and costume candidates, normal generation and
multipart edits, structured visual feedback, malformed images, moderation and
unsupported size. It is not evidence of provider compliance or art quality.

Regenerate from the repository root:

```sh
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m1b-art/author.ts
```

Run the pipeline against a real SQLite-backed project without model calls:

```sh
mkdir -p "$HOME/novelive-art-smoke"
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m1b-art/run.ts "$HOME/novelive-art-smoke"
```

The separate provider smoke uses the same production service. It confirms one
of three generated key visuals, makes a single transparent costume base,
requests its expression edit, and reuses the costume and classroom bases for the CG.
Technical checks and structured visual review run before publishing.

```sh
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m1b-art/provider.ts
```

This command needs the private cassette at
`$HOME/.local/novelive-tools/m1b-art-provider/cassette`; it never calls the
provider in strict mode. Only the designated paid-call executor may use
`NL_REPLAY=record` with the relay environment. Recording mode reuses
existing entries before paying for a missing request and logs each provider
call with usage or its budget reservation. The default unit Check still
uses the repository's synthetic cassette and does not require private files.
The current private cassette reproduces the unsupported expression edit
response (no alpha), so this provider smoke exits nonzero.
