# M2/07 synthetic revision replay

The committed cassette is synthetic. The author answers the writer, art
director, visual audit and image endpoints in-process with Sharp-generated
PNGs; it cannot call any provider. It covers two scene rewrites (editor entry
before a chapter rule is saved, chat entry after it), one direct redraw of a
stale base image and one two-candidate redraw. It is not evidence of provider
quality.

Regenerate from the repository root:

```sh
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m2-revisions/author.ts
```

Run the revisions against a real SQLite-backed project without model calls:

```sh
mkdir -p "$HOME/novelive-revisions-smoke"
NL_REPLAY=strict pnpm exec tsx tests/fixtures/cassettes/m2-revisions/run.ts "$HOME/novelive-revisions-smoke"
```
