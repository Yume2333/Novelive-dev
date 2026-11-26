# 04: Editor polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/editor/, packages/ui/src/locales/*/editor.json, tests/e2e/{m2-editor,m3-custom-marks}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/editor/ + pages/bible/」 (Editor rows, S1–S4, U6–U10), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor|M3 custom marks'` pass.

- [x] **Leaks** L1–L14: the stage footer, expression picks, and cast badges use `formatAssetLabel` with one separator; the mark-proposal banner shows a styled sample (CSS only in `Details`); rewrite hunks are labeled `第 N 处` with sentence ordinals, and NVS directives are humanized (`原文第 1–5 段`, asset names) or moved into `Details`; history entries render through `parseSentenceLines` + `RichText` with no `#lineId`, `cont`, or raw asset keys; the default instruction uses `原文第 7 段`; the source panel has no per-paragraph `p0001 ·` and uses a `原文第 1–5 段` range; scene and chapter select fallbacks use ordinals; the panel title 「NVS 剧本」 becomes 「剧本文本」 in all locales; the jump menu strips tails; one shared speaker display-name helper; compile diagnostics are humanized and rendered with preserved line breaks.
- [x] **Style** S1–S4: `EmptyState`/`LoadingState` replace `editor-empty`/`editor-muted`; delete the dead CSS blocks (`.editor-banner`, `.editor-button*`, `.editor-icon-button*`, `.editor-chip`); one mark-insertion control style (shared `Chip`/`Button`) in both modes; type tokens replace fractional sizes.
- [x] **UX** U6–U10: drop the per-card 「有原文对照」/「连播」 chip noise (keep the information only where it is actionable, with plain wording); reword save errors so they never mention IDs; make undo discoverable on every history entry or state clearly which one it applies to.
- [x] Sync all four locales and update the listed e2e specs where intended copy or DOM changed.

## Progress

- Base commit: 3765fcb805ec811299e48501d04e9ef354dc20ab
- Check after: `NL_REPLAY=strict pnpm check` exit 0 (Test Files 76 passed | 1 skipped (77); Tests 1195 passed | 3 skipped (1198)); `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor|M3 custom marks'`: 10 passed / 0 failed, run twice consecutively (27.8s, 28.1s).
- Review: pass (base 3765fcb, reviewer R-reviewer-04)

### Residuals

- Rewrite-modal screenshot not captured (needs model worker; covered by contract-fixture e2e).
- Dark-theme low-contrast secondary text is a global palette matter (not editor-specific).
- humanizeDiagnostics passthrough can still echo hand-typed NVS grammar parameter names in advanced-mode compile errors (accepted).
- `高级模式` toggle is a styled button with aria-pressed because Chip does not forward aria-pressed (gap for task 01/gate).
- m2-editor fixed-project test sanitizes WAYLAND_DISPLAY/XDG_SESSION_TYPE/ozone hint env to get DPR 1 under xvfb on Wayland hosts.
- Screenshots at /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task04/ (12 images, light+dark).
