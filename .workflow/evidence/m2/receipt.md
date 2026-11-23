# M2 gate — desktop regression receipt

Branch: `devin/1795402319-m2-gate`.

## PR #57 round 3

Confirmed starting HEAD `5bbcdabb2164b347493ecaa3d43fb49e4725cc1a`.

- H (`ea706ae`): the live spinner was nested under the busy workbench; a gate
  observer requiring a non-busy announcement reproduced the missing update.
  Retain the final success/candidate/error status after generation and after
  `aria-busy` becomes false. The gate asserts the persistent completion status
  has no busy ancestor. Loading still shows the spinner.
- I (`e386f39`): inspect the actual image URL after `Image.decode()` in the
  renderer, not just the backend revision. Compare the initial/replacement
  content-hash filenames, require the replacement URL returned by production,
  and require the selected candidate's hash after adoption. A mutation that
  skipped updating the editor cache path failed with the old `editor/ca136a...`
  URL instead of the expected `production/02a735...` URL. Production code was
  restored before final verification.
- CI compatibility (`8912605`): main's new player text renderer has a hidden
  measurement copy, so `textContent` doubles the sentence. Assert visible
  `innerText` instead; keep the exact expected sentence assertion.

No additional recordings or provider requests were made in round 3. Refreshed
screenshots include `07-image-redrawn.png` with its persistent completion status.

```text
Checked 305 files in 149ms. No fixes applied.
Found 1 info.
Test Files 43 passed (43)
Tests 563 passed | 1 skipped (564)
```

```text
✓ tests/e2e/m2-gate.spec.ts:51:1 › M2 revise a work through editor and Agent in real Electron (12.3s)
1 passed (14.5s)
```

Commands: `NL_REPLAY=strict pnpm check` and
`NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'`.

## PR #57 round 2

Started from confirmed HEAD `c905614e0e54d6884b50a033660d40d876150515`.
Each actionable finding was reproduced before fixing it:

- A (`8cf2d60`): after saving a text change and replacing an image, Undo was
  disabled. Refresh only the changed image cache path through
  `production.resolveAsset`; the gate now undoes that text change after redraw.
- B (`c2f830a`): the picker returned `room/nigh` for `room/night`, while missing
  an aliased portrait and short `@face`. Use the script compiler's resolved
  action assets, with tests for aliases, short faces, prefixes, empty scenes,
  pending assets and invalid scripts.
- C (`1c79090`): manually reverting a dirty draft after an Agent update disabled
  discard despite a pending chapter refresh. Keep discard available until the
  pending refresh is consumed; the gate exercises manual revert then discard.
- D: production chat now adds minimal JSON position instructions. A fake model
  request previously lacked the supplied scene ID; its regression checks the
  actual system message. The gate prompt no longer supplies chapter/scene IDs,
  so the real proposal relies on implicit editor context.
- E (`4407bb2`, formatting `dc82200`): generation previously exposed no status
  or spinner. Add an accessible generation status with the existing lucide
  LoaderCircle pattern, token motion and reduced-motion support. The gate
  observes the spinner during generation and verifies successful completion.
- F (`e1ab730`): the old test used both filters at once and could not distinguish
  them. Test each independently; removing either production filter made the
  strengthened test fail (`expected recovered`, `received temporary`). Restore
  production code unchanged before the full check.
- G: retained the pre-existing styled native selects. The production settings
  `Select` in `ModelFields.tsx` is itself a native select; no shared custom
  dropdown exists in the production component directory. Editor selectors
  already use token surfaces, radius and focus styling in `editor.css`. The
  prototype's custom dropdown is not a production component.

Authorized recording ran once and passed: **2 paid requests**, both
`gemini-3.8-flash` (response metadata `gemini-3.8-flash-n`). Proposal:
1206 input + 566 output = 1772 tokens. Continuation: 1805 input + 65 output =
1870 tokens. Total: **3011 input + 631 output = 3642 tokens**. The unchanged
writer request reused its successful recording; all image calls used existing
offline fixtures. Both private usage ledgers contain actual usage, not output
reservations. The committed cassette contains the new proposal/continuation
and the reused writer response. Audit: path-only endpoints, content-type-only
headers, no URLs, authorization headers or absolute home paths in metadata or
decoded SSE bodies.

Final strict checks:

```text
Checked 305 files in 137ms. No fixes applied.
Found 1 info.
Test Files 43 passed (43)
Tests 563 passed | 1 skipped (564)
```

```sh
NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 revise a work|M2 editor'
```

```text
✓ tests/e2e/m2-gate.spec.ts:51:1 › M2 revise a work through editor and Agent in real Electron (8.8s)
10 passed (20.7s)
```

Refreshed the M2 screenshots from this strict run. Display `:0` was not used.
Earlier sections below preserve the first-round receipt and original usage;
the position-context blocker described there is now resolved by round 2.

## Real desktop Check

```sh
NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M2 revise a work'
```

No secrets or `NL_CHAT_CASSETTE_DIR` override are required. The test defaults to
the reviewed committed `tests/fixtures/cassettes/m2-gate/` cassette.

```text
Running 1 test using 1 worker
  ✓  1 tests/e2e/m2-gate.spec.ts:52:1 › M2 revise a work through editor and Agent in real Electron (10.9s)
  1 passed (13.1s)
```

Full output: `strict-gate.txt`. Real Electron verifies source location from the
script, current-line minimal-player preview, editor rewrite with only a selected
hunk applied, real Agent loading, a CJK code-block reply and Chinese confirmation
buttons, `propose_rewrite_scene` approval, disabled application with no checked
hunks, selective Agent hunk application, and scene/history/approved-chat
persistence after closing and reopening the application. The unchecked first
Agent hunk is not applied. Screenshot capture also asserts no native scrollbars.
The final run used the full build-and-gate command above after merging main.

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

## Merge with main

Merged `origin/main` at `f65bf0b`, without rebasing. The textual conflict was
substantive but composable: main added `ignoreRecordedFailures` for replay mode,
while this branch added successful-recording reuse. Both options and filters are
retained. A new unit test combines them and verifies strict misses stay offline;
main's existing test still verifies that `ignoreRecordedFailures` alone does not
alter strict replay.

Main also introduced production queue ownership and desktop quit confirmation.
The gate now marks its manually published fixture work `done`, rather than
leaving it queued with zero tasks. The real application still performs the full
quit/reopen path, with no lifecycle bypass or prompt/cassette change.

After installing main's newly required workspace dependencies and the local
`mesa-vulkan-drivers` runtime, the full checks below pass. Main's CI already
installs the Vulkan package. All recording remains disabled.

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
Checked 303 files in 141ms. No fixes applied.
Found 1 info.
 Test Files  42 passed (42)
      Tests  560 passed | 1 skipped (561)
```

Pre-merge editor/chat/routes checks remain in `existing-e2e.txt`:

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
