# 01: Structured error kinds, shared format layer, and shared display components

**Effort:** ui-polish
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/creator/src/ (contract, models/text, scheduler/chapter, project/production.ts, import/, chat/), packages/ui/src/format/ (new), packages/ui/src/components/, packages/ui/src/styles/, packages/ui/src/i18n/, packages/ui/src/locales/*/{components,format}.json, DESIGN.md, tests/unit/; mechanical call-site updates only in pages/shell/panels for the cutovers below
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md (every "Shared fixes" list), DESIGN.md, docs/ux.md
**Check:** `NL_REPLAY=strict pnpm check && pnpm build` → typecheck, Biome, Stylelint, all unit tests (new format/error tests, creator tests, locale parity), and desktop build pass.

- [x] **Creator contract error kinds.** Export `issueKinds` from `@novelive/creator/contract`. It covers every model error code (`network`, `auth`, `not_found`, `moderation`, `invalid_config`, `reasoning_limit`, `cancelled`, `internal`), every scheduler `errorType` (`budget_paused`, `portrait_framing`, `matting_unavailable`, and any others in `scheduler/chapter/`), and `unknown`. The production snapshot's chapter `issue` becomes `{ kind, detail? }`. `production.chapterRecord` drops the hardcoded zh-CN `message` and replaces the raw-enum `detail` with `errorKind?` plus an optional raw `detail`. Classify at the source: no regex over formatted `[code] …` strings in the UI.
- [x] **Import and project error codes.** Every error thrown under `packages/creator/src/import/` that reaches the UI (EPUB/DOCX/PDF/Markdown/TXT limits, DOCTYPE, non-empty project, illustration mismatch, encoding) gets a contract `importErrorCodes` entry and is surfaced as a command error with that code. Existing `projectErrorCodes` stay. Share/export command errors expose their code if they don't already.
- [x] **Chat subtask label.** The subtask part carries the delegated `task` text (trimmed to one line) as `label` and the role as a separate `role` field. Proposal tool results stay model-facing and unchanged.
- [x] Update creator unit tests and any `tests/unit` contract tests for the new shapes; replay cassettes must keep passing untouched.
- [x] **`packages/ui/src/format/`**: `chapter.ts` (`formatChapterLabel`, numeral, range, `formatParagraphLabel` from `pNNNN`, `formatVolumeLabel`, `formatSceneLabel` ordinal; no function ever returns a raw id), `language.ts` (move the language-name table out of `ImportPage.tsx`), `path.ts` (home-collapse + middle ellipsis; get the home directory from the existing host/app snapshot, or add it there if absent), `cost.ts` (`formatCost`: cents, `< $0.01` floor), `work.ts` (`useWorkTitles` / `formatWorkTitle` with an `已删除的作品` fallback), `asset.ts` (move `backgroundLabel`/`portraitLabel` from `pages/editor/scene-assets.ts` and generalize: asset key → bible names + costume/expression/variant description → humanized slug fallback; one separator convention), `errors.ts` (`humanizeError(kind | code | Error)` → `{ message, hint?, detail? }` covering every `issueKinds`, `projectErrorCodes`, `importErrorCodes`, share and config code, with a generic fallback).
- [x] **Shared components**: `ErrorNotice` (error `Banner` + optional retry + collapsed `Details` for raw detail), `LoadingState`, `Details` (default-collapsed 「详细信息」 disclosure, mono body), and `ButtonLink` (router `Link` with the exact `nl-btn` variant and size classes). `PageAction` renders through `ButtonLink`. Remove `Page`'s `action` alias and migrate callers to `actions`. Delete the `inputStyle`/`textareaStyle` JS objects, move their styling into CSS, and migrate callers. Make `EmptyState` the single empty pattern (icon, optional title, text, optional action, `card`).
- [x] **Type scale**: add font-size tokens to `styles/tokens.css` (integer steps only, e.g. 11/12/13/14/16/18/22/28) and document them in `DESIGN.md` 「排版」. Fix the `components/` and `styles/` sites. Pages are fixed by their surface tasks.
- [x] Register a `format` i18n namespace; add all new strings to `zh-CN`, `zh-TW`, `en`, `ja` (`format.json`, `components.json`).
- [x] Unit tests: chapter/paragraph/volume formatting including miss fallbacks, path collapse, cost rounding, asset label fallbacks, `humanizeError` returns a non-raw message for every exported kind/code, creator classification of model and scheduler failures into `issueKinds`.
- [x] Call-site updates outside the owned folders are limited to compiling the new shapes and APIs (for example `issue.detail ?? ''` → `humanizeError(issue.kind).message`). Redesign belongs to tasks 02–07.

## Progress
- Base commit: e59cecf014d33c57110c88a8cfd9159102ffd2b1
- Check before: not run (branch created at integration head; foundation adds the format/error tests)
- Check after: `NL_REPLAY=strict pnpm check && pnpm build` → exit 0; `Test Files  76 passed | 1 skipped (77)`, `Tests  1195 passed | 3 skipped (1198)`; build `✓ built in 4.76s`
- Review: pass (base e59cecf014d33c57110c88a8cfd9159102ffd2b1, reviewer R-reviewer) — 10 findings + 2 re-review nits fixed
- Evidence: Electron screenshots (library/usage/settings/import wizard/welcome, light + dark) in /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task01/
- Residuals:
  - Page migrations onto `ErrorNotice`/`LoadingState` (replacing bare `<p role="alert">`/`<p role="status">`) — belongs to surface tasks 02/03/06.
  - Shared model-config field components; welcome reuses `ModelFields` incl. 兼容哪家 — belongs to surface task 02 (welcome/pages scope, task file 02 line 12).
  - Stale-asset section removal from usage — belongs to surface task 02.
  - Page-level migration of the four `.ghost`/`.primaryLink`/`.linkButton`/`.primary` link-button CSS reimplementations onto `ButtonLink` — belongs to surface task 03.
  - Page-level application of the canonical `EmptyState` — belongs to surface tasks 02/03/04.
  - Shared NVS-line humanizer (strip `#xxxx`/`cont`/`wait` tails, render via `parseSentenceLines`+`RichText`) applied to history/rewrite/jump menu — belongs to surface task 04 (editor-page scope, task 04 line 10).
  - `.editor-alert` newline handling CSS fix — belongs to surface task 04.
  - Curated bible field rendering replacing generic `Fields` dump — belongs to surface task 05.
  - Locale-safe unit labeling for sliders (drop `" 章"` suffix + zero-width-space hack in en/bible.json) — belongs to surface task 05 (task 05 line 12 explicitly assigns the cutoff-slider restructure).
  - `toolDisplay` registry mapping tool names → localized titles/arg labels/formatters — belongs to surface task 07 (agent panel scope).
  - Player surface migration onto `ErrorNotice` — belongs to surface task 06.
  - Agent tool-card adoption of the default-collapsed 「详细信息」 `Details` disclosure — belongs to surface task 07.
  - Locale voice sweep (没能/无法 consistency, 跳过/略過) + entryId→name resolution — belongs to surface tasks 06/07.
  - `第 {{start}}–{{end}} 章` duplicated in `import` and `format` namespaces; task 03 deletes the import.json copy when ImportPage adopts `formatChapterRange`.
  - `formatChapterLabel`/`formatChapterRange`/`formatParagraphLabel`/`formatSceneLabel`/`formatCost`/`formatPath`/`formatWorkTitle` are not yet adopted by pages; surface tasks 02–07 adopt them, gate verifies.
  - `context_limit` copy is chapter-scoped; correct for every current producer (chapter writing/scene repair/revision).
  - `@keyframes soft-pulse` kept only for `panels/agent/MessageView.module.css` thinking icon; task 07 removes the pulse, then the keyframes and `--glow`.
  - Dark theme muted secondary text is low-contrast on settings model cards and the welcome 界面语言 label; usage date inputs show native `mm/dd/yyyy` placeholder — surface task 02 (settings/welcome/usage).

## Rework round 2 (gate 08 feedback)

Rework round 2 base commit: d433081 (ui-polish/08 merged; branch fast-forwarded, no merge commit needed)

Fixed items:
- **1.** Wire command error enum in `packages/creator/src/contract/index.ts` now derives `...importErrorCodes`/`...projectErrorCodes` spreads from the exported lists, so `creatorCommandError` preserves `invalid_join_target` (and every sibling import/project code) across IPC instead of flattening to `internal`; `ImportPage` join-target failures again render 「无法加入，所选文件夹不是有效的工程。」 and `tests/e2e/m4-import-join.spec.ts` asserts the specific sentence; new `creator-contract` test iterates every import/project code through the boundary. Ripple: `failureKind` in `scheduler/chapter` now runtime-narrows `TextModelError.code` via `issueKinds` membership (widened union type).
- **2.** `format/errors.ts` splits command errors from model error kinds: `{code}`-shaped `internal` → 「无法完成操作，请重试。」 and `not_found` → 「找不到相关内容，请刷新后重试。」 (new key in all four `format.json`); kind-typed inputs keep the model-flavoured copy. `SettingsPage` `readableError` map made total over the widened union; `BiblePage` keeps its more specific page copy with a refreshed comment.
- **3.** Backend zh-CN reason strings replaced by contract enums: `configErrorReasons` (`unreadable`/`invalid_json`/`invalid_fields`/`decrypt_failed`) in `config/schema.ts` and `unreadableProjectReasons` (`moved`/`unreadable`) in `usage/contract.ts`; UI maps them via new `formatConfigErrorReason`/`formatUnreadableProjectReason` helpers in `format/errors.ts` with keys in all four `format.json` (usage keys moved out of `usage.json` symmetrically); `SettingsPage`/`UsagePage` migrated, creator unit tests and `tests/e2e/m4-usage.spec.ts` updated.
- **Nit.** `chat/tools.ts` `childRoles` copy deleted; `ChildRole`/`spawnTool` now derive from the contract's `subtaskRoles`.

Check after: `NL_REPLAY=strict pnpm check && pnpm build` → exit 0; `Test Files  77 passed | 1 skipped (78)`; `Tests  1218 passed | 3 skipped (1221)`; `✓ built` (first run failed on the other worker's unsorted import in `tests/unit/m2-chat.test.ts` — biome safe-autofixed, rerun green). Targeted rerun after the childRoles fix: `pnpm typecheck` exit 0; `npx biome check` on touched chat files clean; `NL_REPLAY=strict npx vitest run tests/unit/m2-chat.test.ts tests/unit/m2-chat-events.test.ts tests/unit/m2-bible-chat.test.ts tests/unit/m2-bible-sources.test.ts` → `Test Files 4 passed (4)`, `Tests 44 passed (44)`.
- Review: pass (base d433081, reviewer w01-review)
