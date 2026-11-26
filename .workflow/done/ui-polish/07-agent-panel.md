# 07: Agent panel polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/panels/agent/, packages/ui/src/locales/*/agent.json, tests/e2e/m2-chat.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/player/ + panels/agent/」 (Agent rows L1–L14, S1–S5, S12–S13, U1–U3, U16–U17), prototype/src/pages/chat/, DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 chat'` pass.

- [x] **Tool display registry** (`panels/agent/tool-display.ts`): every backend tool name in `packages/creator/src/chat/tools.ts` and `chat/index.ts` maps to a localized title (from the arguments when useful, e.g. 「查看第 7 章剧本」) plus 1–3 curated argument and result rows. Ids resolve to chapter, volume, asset, or entry names; patch arrays and unknown keys stay out of the main view. A unit test asserts every exported tool name has an entry.
- [x] **Tool cards** (maintainer decision): the main view is title + curated rows; raw arguments and results go only in a default-collapsed shared `Details` (「详细信息」). Hide the `spawn_agent` tool card (the subtask card represents it). Suppress model-facing proposal result sentences. Render the real image preview via `resourceUrl` or drop the placeholder box.
- [x] **Subtasks and proposals**: subtask titles use the backend `label` (task text), with the role as a localized chip (写手 / 审稿 / …); the proposal impact line uses `formatChapterLabel` with no raw id fallback; redraw cards use `formatAssetLabel` or a thumbnail; rewrite hunks are labeled `第 N 处改动` and diff text uses `--font-body`; the context chip resolves the bible entry name (add an entry-name map alongside `chapterTitles`) and drops the segment rather than showing an id.
- [x] **Style** S1–S5, S12: thinking copy reads 「正在思考 · X.Xs」 / 「思考了 N 秒」; remove the pulsing thinking icon; the send button is circular; edit-box buttons use the shared `Button`; aria-labels are localized with consistent Novelive Agent naming.
- [x] **UX** U1–U3, U16–U17: a short empty-session line; the session menu shows recency to tell apart sessions with the same title; one error voice.
- [x] Sync all four locales and update `m2-chat.spec.ts` where intended copy or DOM changed.

## Progress
- Base commit: 3765fcb805ec811299e48501d04e9ef354dc20ab
- Check before: not run as a gate baseline (worker edits in flight); first observed green run recorded below.
- Check after: `NL_REPLAY=strict pnpm check` → exit 0; tail: `Test Files  77 passed | 1 skipped (78)`, `Tests  1209 passed | 3 skipped (1212)`, `Duration  203.14s` (preceded by Biome `Checked 565 files in 182ms. No fixes applied. Found 33 warnings. Found 2 infos.`). `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 chat'` → exit 0; tail: `Running 2 tests using 1 worker` … `2 passed (10.0s)`.
- Review: pass (base 3765fcb805ec811299e48501d04e9ef354dc20ab, reviewer 07-R-reviewer)
- Evidence: Electron screenshots of the agent panel in light + dark themes (tool card expanded incl. 「详细信息」, streaming/thinking, proposal pending + rejected, session menu with recency, empty session, composer closeup, fullscreen) in /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task07/
- Residuals:
  - `library.list` / `bible.get` fixtures in the m2-chat harness are hand-shaped minimal snapshots (bible.get enriched to full schema shape for the banner fix); they do not exercise real backend data.
  - `第 N 处改动` hunk labels and the empty-session hint line are not e2e-asserted (covered only by visual inspection).
  - `setAgentContextLabel` in `pages/bible/BiblePage.tsx` is now vestigial for the agent panel context chip (the panel no longer consumes a setter); removal belongs to the bible surface task.
  - `read_*` tool result rows only summarize counts (e.g. asset/entry numbers); full per-item rendering of read results is intentionally left to the collapsed 「详细信息」.
  - Host environment note: on this host `/tmp` is a small tmpfs and the stock TMPDIR makes Chromium fail with `Socket path too long`; checks were run with `TMPDIR=/home/shizuku/t07` (short path on a large filesystem).

### Rework (gate 08)
- New base commit: 3d5b40192dae47a86e833baee09024f68ba10ef1
- Fix: both bespoke error presentations in `MessageView.tsx` replaced with the shared `ErrorNotice`. (1) Proposal approve/reject/apply-rewrite failure: `<p className={styles.error} role="alert">{error}</p>` removed; the error state is now a `HumanizedError` built from `humanizeError(failure)` with the visible message overridden to the existing localized copy (`无法提交，请重试` / `无法应用差异，请刷新后重试`), so raw backend text only appears inside the collapsed 「详细信息」. (2) Tool-card failure callout (`errorCallout`/`errorText` div with `role="alert"`) replaced by `ErrorNotice`; `formatErrorText` import dropped. Dead CSS rules `.error`, `.errorCallout`, `.errorCallout svg`, `.errorText` removed; `.toolErrorNotice`/`.proposalErrorNotice` carry only the previous font sizes. No new copy, so locales stay symmetric (existing keys reused). No other bespoke `role="alert"` error UI remains in `panels/agent/`. No test asserted the old markup, so no test updates needed.
- Check after: `pnpm check` → exit 0 (`Checked 572 files in 173ms. No fixes applied. Found 33 warnings. Found 2 infos.`; vitest `Test Files  77 passed | 1 skipped (78)`, `Tests  1212 passed | 3 skipped (1215)`, `Duration 197.77s`). `pnpm build` → exit 0 (`✓ built in 5.53s`). `nl-headless pnpm exec playwright test --grep 'M2 chat'` → exit 0: `Running 2 tests using 1 worker` … `2 passed (5.7s)`. Playwright needs `NODE_OPTIONS=--import <json-hook>` in this environment for the `--grep` worker start (pre-existing Node 24 `with { type: 'json' }` attribute issue in the Playwright TS transform, first hit by window 06 — same hook copied from `/home/shizuku/.cache-uipo/uipo-win-06-home/uipo08-json-*.mjs` into the throwaway `/tmp/uipo-win-07-home/`); without the hook the loader fails on `packages/ui/src/locales/en/agent.json` before any test runs, identically on the untouched integration baseline, so it is environmental and unrelated to this diff.
- Review: pass (base 3d5b40192dae47a86e833baee09024f68ba10ef1, reviewer uipo-07-rework.R07Reviewer)
