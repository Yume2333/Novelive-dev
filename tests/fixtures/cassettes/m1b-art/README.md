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
