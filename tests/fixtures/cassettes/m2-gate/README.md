# M2 gate replay

The cassette is pending an authorized mainline recording. No model calls were
made while implementing this gate. The test uses the real desktop host's config
and replay layer; it does not replace the preload bridge or inject chat replies.

Expected paid requests: three `gemini-3.8-flash` chat-completion calls (proposal,
confirmed scene rewrite, confirmation continuation), each capped at 1024 output
tokens. The initial editor rewrite reuses the committed M2/07 cassette without a
provider call. Provider misbehavior can produce additional tool-loop requests;
the expected three requests are not a hard budget enforcement mechanism.

An authorized mainline session can run from the repository root:

```sh
mkdir -p "$HOME/novelive-private/m2-gate"
NL_REPLAY=record \
NL_CHAT_CASSETTE_DIR="$HOME/novelive-private/m2-gate" \
NL_USAGE_CSV="$HOME/novelive-private/usage.csv" \
xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'
```

Bind `NL_IMAGE_BASE_URL` and `NL_IMAGE_API_KEY` from the provisioned relay secrets
in that session's environment. Do not put them into a file or commit private
recordings. A root relay URL is normalized to `/v1`. Both text slots are explicitly
configured in the desktop host as `gemini-3.8-flash`, OpenAI completions, 12000-token
context, 1024 maximum output tokens, compatibility `auto`. The initial offline
writer call alone uses the existing `devin-swe-2` fixture configuration.

Replay the private recording with the same command, replacing `record` with
`strict`; no secrets are needed for replay. Without the directory override the
gate looks for a sanitized, approved cassette in this directory. Request UUIDs
and generated NVS line IDs are normalized only for these gate replay identities;
all content, model names and tool schemas remain part of the hash. Production
first checks the existing M2/07 fixtures with their original hash algorithm.

The replay layer appends a per-request reservation to the private usage CSV before
each actual request, including failed requests. It never logs authorization or
relay addresses. The private cassette contains the three responses and optional
external bodies. Committed screenshots and the short verification receipt belong
in `.workflow/evidence/m2/`, not in the private directory.
