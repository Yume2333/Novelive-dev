# 05: Bible polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/bible/, packages/ui/src/locales/*/bible.json, tests/e2e/m2-bible.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/editor/ + pages/bible/」 (Bible rows L15–L22, S4–S8, U1–U13), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 bible'` pass.

- [ ] **Leaks** L15–L22: every chapter stamp (first appearance, occurrences, change chips, timeline, foreshadowing, outfit start, knows) uses `formatChapterLabel` with the page's `chapterOrder`; occurrences read `第 N 章 · 第 M 段`; costume/expression/variant labels use `formatAssetLabel` (description fallback, no raw slugs; lightbox titles included); reference images show no file paths; candidate fields and conflict diffs format chapter values and never show raw English keys; volume fallback uses `formatVolumeLabel`; 「跨章节定位」/「定位」 becomes 「出现位置」/「原文出处」; tooltips don't mention "ID"; proposal titles are synthesized per kind (`A → B`, event text, description).
- [ ] **Fields dump** U1: replace the generic recursive `Fields` with curated per-kind sections; unknown keys go into a collapsed 「其他信息」 with localized or humanized labels; chapter-aware formatting in `StructuredValue`/`formatConflictValue`.
- [ ] **Style** S4–S8: type tokens; inline `ul` resets moved to CSS; restructure the cutoff slider label so no locale needs the `" 章"` suffix or zero-width-space hack; status chip emphasis on candidates (needs attention), confirmed quiet, one candidate marker convention; candidate drawer prompts are body text, not `<h3>`.
- [ ] **UX** U3–U13: glossary occurrences don't blow up row height; nav counts consistently respect the cutoff; stale proposals show a warning `Banner` explaining why 接受 is disabled, with no filler 「待确认」 line; cutoff copy explains that it filters the display; long descriptions clamp with an expander; the glossary action column collapses into row hover; one ask-agent affordance style.
- [ ] Sync all four locales and update `m2-bible.spec.ts` where intended copy or DOM changed.
