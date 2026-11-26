# UI Polish: Consistent Style and Creator-Facing Display

**Status:** in progress
**Priority:** high
**Integration branch:** ui-polish/integration

## What this is for

After `ui-prototype-fidelity` the app has the full control kit, but the screens still talk like a debugger. Creators and players see internal ids (`ch0001`, `p0003`, `joined-<uuid>`, work UUIDs, `h3`, `#a3f9`), asset keys (`ada/uniform/neutral`, `room · day`), tool names (`read_bible`, `spawn_agent`), English backend errors (`[network] Model connection interrupted…`, `DOCTYPE is not supported`), raw enums (`budget_paused`, `writer`), raw JSON, raw CSS, NVS syntax, absolute temp paths, and 4-digit dollar amounts. The same concept is styled several ways: four link-button implementations, three card constructions, three error presentations, fractional font sizes, and at least four chapter-label formats. This effort makes every surface speak the creator's language and follow one visual system.

## What it does

1. Gives the backend contract structured error kinds instead of preformatted strings, so the UI can localize every failure in four languages.
2. Adds one shared formatting layer (`packages/ui/src/format/`) for chapters, paragraphs, volumes, languages, paths, money, work titles, asset labels, and errors, plus shared `ErrorNotice`, `LoadingState`, `Details` disclosure, and `ButtonLink` components and a type-scale token set.
3. Applies them across every surface (shell, welcome, library, usage, settings, import, work, confirm, production, editor, bible, player, agent panel), removing leaked technical detail, unifying style, and fixing the display and UX problems listed in `.workflow/research/ui-polish-audit.md`.

## How it is built

- **Foundation first (`01`).** Creator contract error kinds, the `format/` module, shared components, type tokens, and the mechanical API cutovers they require (removing `Page.action`, `inputStyle`/`textareaStyle` JS objects, and moving `scene-assets` label helpers into `format/`). Surface tasks consume these; they do not add competing helpers.
- **Six disjoint surface tasks (`02`–`07`).** Each owns its folders, locale files, and the e2e specs that assert its copy.
- **Gate (`08`).** Full check and e2e, a raw-id leak sweep, before/after screenshots of all 14 surfaces in both themes, rework routing, and a Linux AppImage rebuild.

### Display rules every task applies

- Never render an internal id, key, hash, enum, slug, file path inside the project, tool name, or JSON as primary text. When a lookup misses, fall back to a localized ordinal or a generic name (`第 3 章`, `未命名章节`, `已删除的作品`, `造型 1`). Drop the segment if neither is available.
- Chapter prose label: `第 N 章 · 标题`; row numeral column may stay zero-padded. Volume: `第 N 卷`. Paragraph: `第 N 段`. Ranges: `第 1–5 段`. One formatter, half-width spaces, one locale key family.
- Asset display names (maintainer decision): no format change. Use bible names plus the costume / expression / variant `description`; when that is missing, humanize the slug. No raw `a/b/c` keys.
- Errors (maintainer decision): backend sends a kind or code; the UI maps it to a localized sentence with a recovery hint. Raw detail goes only inside a collapsed 「详细信息」 disclosure.
- Agent tool cards (maintainer decision): localized title plus 1–3 curated rows in the main view; raw arguments and results go only inside a collapsed 「详细信息」.
- Usage page (maintainer decision): the per-call list becomes per-day / per-model aggregates; the stale-assets section is removed (the production page owns it).
- User-chosen paths stay visible but are home-collapsed (`~/…`) and middle-truncated.
- Style: font sizes only from type tokens, spacing only `--space-*`, one `Card`, one `Button`/`ButtonLink`, one `EmptyState` pattern (icon + optional title + text + optional action), `ErrorNotice` for every error, `LoadingState` for every load. No bespoke per-page button/card/error CSS.
- Copy: one error voice (`无法…，请重试`), no developer terms (NVS, ID, 槽位, 毫秒, 原始数据, 日志), the four status words from `DESIGN.md`, and symmetric `zh-CN`/`zh-TW`/`en`/`ja` locales.

## What it must not do

- Do not change the work package format (`packages/format/`) or break `NL_REPLAY=strict` cassettes.
- Do not delete backend data that power users need. Move it behind `Details` instead, unless the decisions above say remove.
- Do not add mock data, fake buttons, or local-only edits; no hardcoded colors outside `tokens.css`; no native scrollbars; no paid API calls.

## How we will know it works

- **W1.** `NL_REPLAY=strict pnpm check` passes on `ui-polish/integration`, including unit tests for `format/`, error-kind classification, and four-locale key parity.
- **W2.** `pnpm build` and the full offline e2e suite (`NL_REPLAY=strict pnpm test:e2e`) pass.
- **W3.** The gate's leak sweep (`.workflow/evidence/ui-polish/leak-sweep.txt`) finds no raw-id, key, enum, tool-name, path, or JSON rendering in `packages/ui/src/{shell,pages,panels}` outside `Details` disclosures and test-only `data-*` attributes.
- **W4.** Before/after screenshots of all 14 surfaces in light and dark themes are in `.workflow/evidence/ui-polish/` with a per-surface matrix in `audit.md`. Every high and medium finding in the research note is fixed or listed as a residual with its reason.
- **W5.** `pnpm --filter @novelive/desktop run package:linux` produces a Linux AppImage on the integrated revision that launches cleanly.
