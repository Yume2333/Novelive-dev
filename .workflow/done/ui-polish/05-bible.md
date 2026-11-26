# 05: Bible polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/bible/, packages/ui/src/locales/*/bible.json, tests/e2e/m2-bible.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/editor/ + pages/bible/」 (Bible rows L15–L22, S4–S8, U1–U13), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 bible'` pass.

- [x] **Leaks** L15–L22: every chapter stamp (first appearance, occurrences, change chips, timeline, foreshadowing, outfit start, knows) uses `formatChapterLabel` with the page's `chapterOrder`; occurrences read `第 N 章 · 第 M 段`; costume/expression/variant labels use `formatAssetLabel` (description fallback, no raw slugs; lightbox titles included); reference images show no file paths; candidate fields and conflict diffs format chapter values and never show raw English keys; volume fallback uses `formatVolumeLabel`; 「跨章节定位」/「定位」 becomes 「出现位置」/「原文出处」; tooltips don't mention "ID"; proposal titles are synthesized per kind (`A → B`, event text, description).
- [x] **Fields dump** U1: replace the generic recursive `Fields` with curated per-kind sections; unknown keys go into a collapsed 「其他信息」 with localized or humanized labels; chapter-aware formatting in `StructuredValue`/`formatConflictValue`.
- [x] **Style** S4–S8: type tokens; inline `ul` resets moved to CSS; restructure the cutoff slider label so no locale needs the `" 章"` suffix or zero-width-space hack; status chip emphasis on candidates (needs attention), confirmed quiet, one candidate marker convention; candidate drawer prompts are body text, not `<h3>`.
- [x] **UX** U3–U13: glossary occurrences don't blow up row height; nav counts consistently respect the cutoff; stale proposals show a warning `Banner` explaining why 接受 is disabled, with no filler 「待确认」 line; cutoff copy explains that it filters the display; long descriptions clamp with an expander; the glossary action column collapses into row hover; one ask-agent affordance style.
- [x] Sync all four locales and update `m2-bible.spec.ts` where intended copy or DOM changed.

## Progress

- Base commit: 3eaa03c4dc567bebec293255094ad147d1229cee
- Merge-base with integration: 3765fcb805ec811299e48501d04e9ef354dc20ab (integration moved ahead of this branch)
- Check before: n/a (new copy/DOM)
- Check after: `NL_REPLAY=strict pnpm check` → exit 0, `Test Files 76 passed | 1 skipped (77); Tests 1198 passed | 3 skipped (1201)`; `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 bible'` → exit 0, `2 passed (10.4s)`
- Review: pass (base 3eaa03c4dc567bebec293255094ad147d1229cee, reviewer w05-R-reviewer)
- Evidence: /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task05/ (light/dark PNGs + text dumps for characters, relations, locations, timeline, foreshadowing, styles, glossary, candidates, lightbox-styleref; glossary re-verified after layout fix at /tmp/w05-glossary-{light,dark}.png)
- Residual:
  - Stale-proposal banner and candidate prompt (`综合候选：character/ada/…`) show backend-authored English/id strings (`action.reason`, `proposal.prompt`) — needs structured reason codes from creator (window 01/backend).
  - U2 key colors English text from model output — pipeline/prompt issue, not UI-fixable.
  - Cutoff Slider shared component always renders its own numeric readout, so the label 「显示至第 N 章」 and readout both show the number — gap in shared `Slider` (window 01) recorded for the gate.
  - Expression-card lightbox (drawn state) not captured in screenshots because production.resolveAsset needs the model session in the offline fixture; the styleRef lightbox is captured.
  - Unknown open-schema keys are humanized English (e.g. 「Nickname hint」) since no localized label exists.
  - tests/unit/m2-bible-character-detail.test.ts was rewritten (outside Files line) because the removed `Fields` export it tested was replaced by OtherFields.
