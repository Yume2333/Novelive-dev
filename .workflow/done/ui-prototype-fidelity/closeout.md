# Closeout: ui-prototype-fidelity

**Accepted:** 2026-11-25 by agent (omp-vibe-windows)

## Shipped

- **01 — control kit & global styles** (`packages/ui/src/components/`, `styles/`): full prototype control library ported — `Motion`/`usePresence`/`Collapse`, `ToastProvider`, `Modal` portal, `Drawer` portal, `ConfirmDialog`, `Dropdown` presence, `Tooltip`/`InfoTooltip`, `Checkbox`, `RadioGroup`, `Slider`, `SearchInput`, `Skeleton`, `Stepper`, `CompactSelect`, `TierPicker`, `Toggle` (role=switch), `Pagination`, `StatusPill`, `ChapterStatusMark`, `ProgressBar`, `GradientCover` with author line/lighthouse motif, fixed `ScrollArea`, tokens/base/shell parity; clean barrel export, locale parity across zh-CN/zh-TW/en/ja, focused unit tests.
- **02 — shell & queue drawer** (`shell/`): AppShell navigation (clapperboard 制作 / BookOpenText 设定集 icons), GlobalProductionQueue as prototype Drawer with plain gradient thumbs, reorder controls, no native-title regressions.
- **03 — global pages**: Welcome (stepper, language RadioGroup), Library (series/volume grouping with `· ` separator, phase-aware status lines, progress bars), Usage (CompactSelect filters, metric cards, bar chart), Settings (model rows, licenses Modal, theme controls).
- **04 — authoring pages**: Import wizard (stepper, dropzones, custom radios), Work page (hero cover, phase card, chapter rows), ConfirmVisual/ConfirmFirst (candidate cards, breadcrumb, PlayCircle), Production page (failure banner, pipeline steps, run-record Drawer, stop ConfirmDialog).
- **05 — editor workbench**: live stage with scene/position chips and edge chevrons, stage footer controls, sentence cards with mark pills, 修改历史 Drawer, editor Dropdown menus.
- **06 — bible workbench**: 截至第 slider + chapter readout, volume CompactSelect, category sidebar, character detail with chips, costume gallery, clickable 候选与冲突 Chip row driving the modal Drawer.
- **07 — player & agent**: prototype player overlays (system menu, save/load grids, settings, history) with gradient soft dialogue and inline next-glyph chevron, Toggle tracks, agent panel with localized tool titles, inline rename, send-icon composer, shrink-wrapped assistant bubbles.
- **08 — integration gate**: static control audit, W2/W3 verification rounds 1–5, W4 side-by-side audit with three rework rounds closed out, selector-only E2E migrations, W5 packaging.

## Verification

- **W1 (control kit completeness / zero unintended native controls):** static audit green — `.workflow/evidence/ui-prototype-fidelity/control-audit.txt` (HEAD ea4b05c; kit export surface verified against the spec's component list; zero unintended native `<dialog>`/`<details>`/bare `<select>`/unstyled checkbox-radio in `pages/`, `shell/`, `panels/` outside intentional usage).
- **W2 (`NL_REPLAY=strict pnpm check` + `pnpm build`):** PASS, exit 0 — typecheck 0 errors; biome + stylelint 0 errors (35 warnings + 2 infos, all pre-existing style diagnostics); vitest 75 passed | 1 skipped files, 1142 passed | 3 skipped tests; electron-vite build main/preload/renderer succeeded. Evidence: `.workflow/evidence/ui-prototype-fidelity/check-summary.txt` (round 4) and round-5 log citation inside `e2e-summary.txt`.
- **W3 (offline Electron E2E):** consolidated round-5 result **81 passed / 1 failed / 3 skipped of 85** at `--workers=1` fully off-screen. The one failure (m3-text.spec.ts:389 `sawInflatedLine`) is a pre-existing environment-dependent fixture gap documented before this effort (`.workflow/evidence/prototype-parity/player-agent/audit.md:24`); m1b-production-contract and m4-single-instance are round-4-proven pre-existing environment issues on pristine main 3a8ba3b; rotating click-timeout/pixel flakes root-caused to byte-identical-to-main test-margin fragilities under machine memory pressure. Zero regressions attributable to this effort. Evidence: `.workflow/evidence/ui-prototype-fidelity/e2e-summary.txt` (round 5), `w3-e2e-summary.txt` (round 3).
- **W4 (side-by-side prototype audit, 14 surfaces, light+dark):** `.workflow/evidence/ui-prototype-fidelity/audit.md` + 99 matched-viewport PNG pairs in `.workflow/evidence/ui-prototype-fidelity/screenshots/` (1440×900 both sides, DPR 1). Round-3 matrix: 12/14 PASS, 2 FAIL (settings chevron R4-2, player toggle track R4-1 + sysmenu focus R4-3) — all three fixed in round-4 rework (commits aafbc39, 707ffe2) plus agent bubble R4-5 (dd1c0f7); round-3 rework items verified 10/10 FIXED in image + source + built artifacts. Backend-limited residuals (11 items) documented verbatim in audit.md § Backend-limited residuals — no faked persistence anywhere.
- **W5 (Linux AppImage):** PASS — `pnpm --filter @novelive/desktop run package:linux` produced Novelive-0.0.0-linux-x86_64.AppImage (525,639,015 bytes, sha256 05f7d005c094d78be923343102a9c1a6ee1033d26865e5d54614807619a51596); headless smoke-launch 18/18 PASS (packaged UI rendering, theme switching, navigation). Path, hash and smoke evidence in `.workflow/evidence/ui-prototype-fidelity/audit.md` § Linux AppImage and `.workflow/evidence/ui-prototype-fidelity/appimage/` + `appimage-smoke.png`

## Key fixes in the integrated revision

- Round-2: player gradient soft-dialogue restoration, inline next-glyph chevron, agent localized tool titles/rename/send icon; Drawer scrim de-blurred per feedback 1a.
- Round-3: order-proof CSS-module overrides vs base.css typography cascade (drawer/modal titles, slider readout, quiet-published label) without `!important`; queue thumbs/icons; library separator; confirm pills/icons; bible chip row; player Tooltip replacing native title.
- Round-4: CompactSelect chevron inside sized shells (kit `width: 100%`), player toggle track visibility + sysmenu focus/layout, agent bubble shrink-wrap, work 更多 menu ordering.
- Gate test migrations (tests/ only, assertions never weakened — several strengthened): Toggle role=switch helper `tests/e2e/support/toggle.ts`, player multi-status scoping, bible Drawer close interaction, toast aria-live exclusion in the locale scan, licenses-modal expectations inverted upward. m3-gate launch() constant `'全部 2 章已发布'` verified correct against prototype phase-done semantics.

## Remaining debt & follow-ups

- Accepted divergences and backend-limited residuals are recorded verbatim in `.workflow/evidence/ui-prototype-fidelity/audit.md` § *Accepted divergences (carried forward, re-verified)* and § *Backend-limited residuals* (11 items — prototype affordances with no backend command, correctly absent or read-only rather than faked).

- No paid calls were made during this effort (NL_REPLAY=strict end-to-end).
