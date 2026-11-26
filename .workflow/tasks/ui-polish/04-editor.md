# 04: Editor polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/editor/, packages/ui/src/locales/*/editor.json, tests/e2e/{m2-editor,m3-custom-marks}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/editor/ + pages/bible/」 (Editor rows, S1–S4, U6–U10), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor|M3 custom marks'` pass.

- [ ] **Leaks** L1–L14: the stage footer, expression picks, and cast badges use `formatAssetLabel` with one separator; the mark-proposal banner shows a styled sample (CSS only in `Details`); rewrite hunks are labeled `第 N 处` with sentence ordinals, and NVS directives are humanized (`原文第 1–5 段`, asset names) or moved into `Details`; history entries render through `parseSentenceLines` + `RichText` with no `#lineId`, `cont`, or raw asset keys; the default instruction uses `原文第 7 段`; the source panel has no per-paragraph `p0001 ·` and uses a `原文第 1–5 段` range; scene and chapter select fallbacks use ordinals; the panel title 「NVS 剧本」 becomes 「剧本文本」 in all locales; the jump menu strips tails; one shared speaker display-name helper; compile diagnostics are humanized and rendered with preserved line breaks.
- [ ] **Style** S1–S4: `EmptyState`/`LoadingState` replace `editor-empty`/`editor-muted`; delete the dead CSS blocks (`.editor-banner`, `.editor-button*`, `.editor-icon-button*`, `.editor-chip`); one mark-insertion control style (shared `Chip`/`Button`) in both modes; type tokens replace fractional sizes.
- [ ] **UX** U6–U10: drop the per-card 「有原文对照」/「连播」 chip noise (keep the information only where it is actionable, with plain wording); reword save errors so they never mention IDs; make undo discoverable on every history entry or state clearly which one it applies to.
- [ ] Sync all four locales and update the listed e2e specs where intended copy or DOM changed.
