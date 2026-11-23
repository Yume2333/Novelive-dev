# M2 gate — desktop regression receipt

Branch: `devin/1795402319-m2-gate`.

## Real desktop Check

```sh
NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'
```

No secrets or `NL_CHAT_CASSETTE_DIR` override are required. The test defaults to
the reviewed committed `tests/fixtures/cassettes/m2-gate/` cassette.

```text
Running 1 test using 1 worker
  ✓  1 tests/e2e/m2-gate.spec.ts:52:1 › M2 revise a work through editor and Agent in real Electron (8.3s)
  1 passed (9.3s)
```

Full output: `strict-gate.txt`. Real Electron verifies source location from the
script, current-line minimal-player preview, editor rewrite with only a selected
hunk applied, real Agent loading, a CJK code-block reply and Chinese confirmation
buttons, `propose_rewrite_scene` approval, disabled application with no checked
hunks, selective Agent hunk application, and scene/history/approved-chat
persistence after closing and reopening the application. The unchecked first
Agent hunk is not applied. Screenshot capture also asserts no native scrollbars.
The final run used `pnpm exec playwright test --grep 'M2 revise a work'` against
the same already-built desktop artifact; the full build-and-gate command above
also passed during this review (1 passed, 11.5s).

## PR #57 review follow-up

All review checks used strict replay; no additional provider requests were made.
Display `:0` was not used.

| Finding | Resolution |
| --- | --- |
| 1: Agent refresh discards a dirty draft | `f84d083`: retain the draft and defer refresh until explicit discard; gate asserts both. |
| 2: Approved hunks disappear on Agent reopen | `66cd389`: hydrate the persisted rewrite and retire it after successful application; gate reopens before and after applying. |
| 3: First-chapter redo rejected at its checkpoint | `73c0f56`: permit only the completed first chapter at `confirm_first`; unit test proves later chapters remain gated. |
| 4: Position missing from model instructions | **Unresolved, authorization needed.** A fake upstream captured a `projectChat` request for `改写这里` with an editor position but no `aabbccdd` in the model request. `ChatService.generate` reads an optional instructions callback which `projectChat` does not set. Adding it changes request hashes and requires a newly authorized cassette recording; neither prompt nor cassette was changed. The gate currently supplies IDs explicitly in its user prompt, so its pass does not verify implicit position context. |
| 5: Equivalent script formatting rejected | `d0be287`: match hunk line IDs against the verified raw scene base; unit tests cover compact narration and stale reapplication. |
| 6: Gate absent from CI smoke | `a4ee1f5`: include M2 and update the creation navigation expectation for the editor route. |
| 7: No redraw controls | `549acd4`, `28a2047`, `d499c32`: expose redraw, cached candidate previews and selection; assert asset revision change and two persisted image-history records. Existing `m2-revisions` fixtures cover all calls offline. |
| 8: Intermediate fallback miss logged | `5758a13`: log only terminal misses; unit test asserts no log on a primary hit and exactly one log on a terminal miss. |
| 9: Unstyled markdown code blocks | `49358e8`: token surfaces, aligned language/actions, CJK-safe mono font and wrapping without a native scrollbar; strict gate asserts computed geometry and styles. |

The redraw cassette uses the same blue geometric subject as the initial image:
revision/history assertions verify replacement, not a new artistic appearance.
Screenshot `07-image-redrawn.png` waits for assets and player text to load.

## Screenshots

- `01-source-and-preview.png`: original source and minimal player.
- `02-editor-rewrite.png`: one editor hunk checked, the other unchecked.
- `03-agent-loaded.png`: real Agent panel without a session-load error.
- `04-agent-cjk-confirm.png`: Chinese code block and 拒绝 / 确认 buttons.
- `05-agent-rewrite-selected.png`: Agent rewrite hunks, only the sound addition
  checked, with 应用勾选差异 visible.
- `05-agent-rewrite-applied.png`: only the selected Agent hunk persisted in script.
- `06-reopened-persisted.png`: reopened script, approved proposal and CJK reply.
- `07-image-redrawn.png`: real editor redraw controls and loaded player preview.

## CI checks

`NL_REPLAY=strict pnpm check` runs typecheck, lint and all unit tests; output is
in `ci-check.txt`. The only informational Biome finding is the existing one in
untouched `tests/fixtures/text-models/build-synthetic.ts`.

```text
Checked 243 files in 109ms. No fixes applied.
Found 1 info.
 Test Files  29 passed (29)
      Tests  397 passed (397)
```

Relevant editor/chat/routes checks remain in `existing-e2e.txt`:

```text
  12 passed (19.3s)
```

## Authorized recording and usage

The user explicitly authorized provider recording and committing the reviewed
cassette. Three completed responses were recorded across resumptions after real
test failures; successful responses were reused, not repurchased. One writer
request was cancelled by the old five-second assertion timeout before any usage
response was returned. That timeout is now aligned with the model timeout, and
the CJK code-block locator excludes tool-detail code blocks.

All four upstream attempts requested `gemini-3.8-flash`; completed SSE metadata
reports `gemini-3.8-flash-n`. Counts below are provider-reported tokens, including
reasoning in the output column:

| Attempt | Purpose / cassette key | Input | Output | Total | Reasoning subset |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Agent proposal / `139b150a39b3ef23` | 1184 | 430 | 1614 | 343 |
| 2 | Writer cancelled before usage | unknown | unknown | unknown | unknown |
| 3 | Writer / `005140faa75cacdb` | 390 | 669 | 1059 | 619 |
| 4 | Agent continuation / `bbd8dde6c30ac366` | 1648 | 30 | 1678 | 23 |
| **Completed only** | **3 responses** | **3222** | **1129** | **4351** | **985** |

The exact all-attempt token total cannot be recovered from the cancelled request:
the provider returned no usage for it. Its 1024-token output reservation is not
reported as actual usage or added to the known actual total. There were no image
calls; the initial editor rewrite used an existing offline fixture. No additional
provider calls were made for screenshots or strict verification.

Actual per-call totals and the explicitly labelled cancelled-call reservation
were written to both private ledgers, preserving the memory CSV's six columns:

- `$HOME/novelive-private/usage.csv`
- `$HOME/memory/poke_5b9601/files/novelive/usage.csv`

Neither private ledger nor raw recording logs are committed. The cassette audit
decoded every SSE response and checked metadata for the provisioned key and
relay hostname, URLs, auth headers, and absolute home paths. All checks passed;
only `content-type` headers and `/v1/chat/completions` endpoint paths are stored.

## Wiring choices retained

- Editor and Agent reuse production `rewriteScene` / `redraw` / `adoptImage` /
  `redo` via `CreativeRevisions`, looking up the current production session when
  a worker method runs. Redraw candidates are copied to application-cache paths.
- Existing editor route, minimal player, token-based CJK fonts and custom
  scrollbars are retained; current scene context is passed to Agent.
- Gate replay identity normalization is opt-in; earlier fixtures are unchanged.
- Agent rewrite hunks use separate, token-styled blocks with CJK-capable
  `--font-mono`, keeping checkbox selection and before/after text readable.
- The backend produces no mark suggestions. Registered `editor.resolveMark`
  version-checks and returns `not_found` for nonexistent suggestions, rather than
  introducing a suggestion producer outside this gate's scope.
