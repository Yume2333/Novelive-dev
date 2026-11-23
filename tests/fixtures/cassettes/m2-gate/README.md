# M2 gate replay

PR #57 round 2 replaced the Agent proposal and continuation after authorizing
minimal current-position instructions. The user prompt no longer supplies IDs.
One recording run passed with two paid requests: proposal 1206 input / 566
output, continuation 1805 input / 65 output (3642 total tokens). The unchanged
writer response was reused, not purchased again. Both private ledgers record
the actual usage. The three committed responses were re-audited as below.

The approved cassette contains three real `gemini-3.8-flash` responses: the Agent
`propose_rewrite_scene` call with a Chinese code block, the confirmed scene rewrite,
and the Agent continuation. The provider reports `gemini-3.8-flash-n` in SSE
metadata. Requests use the same desktop configuration and replay layer as the
application; no preload replacement or injected Agent reply is involved.

From the repository root, without secrets or directory overrides:

```sh
NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'
```

The test defaults to this directory. The initial editor rewrite reuses the
committed M2/07 fixture through the production fallback. UUIDs and generated NVS
line IDs are normalized only in gate request identities; model, prompts and tool
schemas remain hashed and recorded responses are unchanged. Earlier production
fixtures retain their original identity algorithm.

Privacy review decoded all three SSE bodies and checked the JSONL metadata:
only `content-type` response headers, path-only request endpoints, no API keys,
authorization headers, relay hostname/URL, or absolute home paths. The private
recording and usage ledgers remain outside the repository.

Authorized recording command (not needed for normal checks):

```sh
mkdir -p "$HOME/novelive-private/m2-gate"
NL_REPLAY=record \
NL_CHAT_CASSETTE_DIR="$HOME/novelive-private/m2-gate" \
NL_USAGE_CSV="$HOME/novelive-private/usage.csv" \
xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'
```

Recording requires provisioned `NL_IMAGE_BASE_URL` and `NL_IMAGE_API_KEY` in the
exec environment. A root relay URL is normalized to `/v1`. Main and writing use
OpenAI completions, `gemini-3.8-flash`, 12000-token context, maximum output 1024,
compatibility `auto`; shared budgeting reduces the Agent request cap to 768.
Recording resumes successful matching responses instead of purchasing them
again; missing or failed responses still require provider calls. Live-model
assertions allow the existing 90-second model timeout to complete.

Completed response usage: 3222 input + 1129 output = 4351 tokens. One earlier
writer attempt was cancelled by the test timeout before it returned usage; its
actual tokens are unknown, not zero. Both private usage ledgers include that
attempt separately as an output reservation, not actual usage. See
`.workflow/evidence/m2/receipt.md` for per-call accounting and screenshots.
