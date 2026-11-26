# 07: Agent panel polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/panels/agent/, packages/ui/src/locales/*/agent.json, tests/e2e/m2-chat.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/player/ + panels/agent/」 (Agent rows L1–L14, S1–S5, S12–S13, U1–U3, U16–U17), prototype/src/pages/chat/, DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 chat'` pass.

- [ ] **Tool display registry** (`panels/agent/tool-display.ts`): every backend tool name in `packages/creator/src/chat/tools.ts` and `chat/index.ts` maps to a localized title (from the arguments when useful, e.g. 「查看第 7 章剧本」) plus 1–3 curated argument and result rows. Ids resolve to chapter, volume, asset, or entry names; patch arrays and unknown keys stay out of the main view. A unit test asserts every exported tool name has an entry.
- [ ] **Tool cards** (maintainer decision): the main view is title + curated rows; raw arguments and results go only in a default-collapsed shared `Details` (「详细信息」). Hide the `spawn_agent` tool card (the subtask card represents it). Suppress model-facing proposal result sentences. Render the real image preview via `resourceUrl` or drop the placeholder box.
- [ ] **Subtasks and proposals**: subtask titles use the backend `label` (task text), with the role as a localized chip (写手 / 审稿 / …); the proposal impact line uses `formatChapterLabel` with no raw id fallback; redraw cards use `formatAssetLabel` or a thumbnail; rewrite hunks are labeled `第 N 处改动` and diff text uses `--font-body`; the context chip resolves the bible entry name (add an entry-name map alongside `chapterTitles`) and drops the segment rather than showing an id.
- [ ] **Style** S1–S5, S12: thinking copy reads 「正在思考 · X.Xs」 / 「思考了 N 秒」; remove the pulsing thinking icon; the send button is circular; edit-box buttons use the shared `Button`; aria-labels are localized with consistent Novelive Agent naming.
- [ ] **UX** U1–U3, U16–U17: a short empty-session line; the session menu shows recency to tell apart sessions with the same title; one error voice.
- [ ] Sync all four locales and update `m2-chat.spec.ts` where intended copy or DOM changed.
