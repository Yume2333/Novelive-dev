# Image adapter synthetic cassettes

Every entry is synthetic (`case: synthetic-*`, tags `synthetic` and
`not-a-provider-recording`). These exercise the SDK's JSON/multipart serialization,
error mapping, alpha validation, downloads and cache output offline. They do **not**
prove that a relay or provider supports a capability. Real success recordings are
listed in task `m0-skeleton/08` for the paid-call coordinator to record.

Rebuild offline from the repository root:

```sh
NL_REPLAY=strict node tests/fixtures/image-models/build-synthetic.mjs
```

The builder explicitly passes an in-memory synthetic fetch to the cassette writer;
it never delegates to native fetch. The SDK's multipart FormData detection issues
a local `data:,` GET, represented by path `,` in the cassette schema. PNG inputs
are generated with the repository's pinned sharp version. Tests consume the
committed JSONL only, always in strict mode, with a throwing upstream fetch.
