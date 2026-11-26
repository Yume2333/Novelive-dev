# 08: Integration gate, leak sweep, before/after audit, and AppImage

**Effort:** ui-polish
**Blocked by:** 02, 03, 04, 05, 06, 07
**Covers:** W1, W2, W3, W4, W5
**Files:** tests/, .workflow/evidence/ui-polish/, .workflow/specs/ui-polish.md, .workflow/done/ui-polish/
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md, DESIGN.md, .workflow/evidence/ui-prototype-fidelity/ (before screenshots)
**Check:** `NL_REPLAY=strict pnpm check && pnpm build && xvfb-run -a env NL_REPLAY=strict pnpm test:e2e` pass; `leak-sweep.txt` and `audit.md` exist; `pnpm --filter @novelive/desktop run package:linux` succeeds and the AppImage launches.

- [ ] **Leak sweep** → `.workflow/evidence/ui-polish/leak-sweep.txt` (verbatim command output plus a verdict per hit): search `packages/ui/src/{shell,pages,panels}` for rendered `?? *\w*Id\b` / `?? *\w*Key\b` fallbacks, `ch\d{4}`/`p\d{4}` literals, `{part.name}`-style tool-name rendering, `JSON.stringify`/`pretty(` outside `Details`, raw `error.message` rendering, `assetKey`/`assetId` in JSX text, absolute-path rendering without `formatPath`, fractional `font-size`, bare `<p role="alert">`. Every remaining hit is justified (test-only `data-*`, inside `Details`) or fixed.
- [ ] Full offline check, build, and the entire e2e suite. Fix shared or gate-owned specs (`m*-gate`, `m5-delivery`, `m5-share`, `m5-packaged`, `prototype-parity`, `m2-contract-routes`, `m0-lifecycle`, `m4-single-instance`) only for intended copy/DOM changes; never weaken an assertion.
- [ ] **Before/after audit**: capture all 14 surfaces (shell/queue, welcome, library, usage, settings, import, work, confirm-visual, confirm-first, production, editor, bible, player, agent) in light and dark with realistic replay data that exercises failure states (a failed chapter, a stale asset, an unreadable project, tool cards). Inspect each image. Write `.workflow/evidence/ui-polish/audit.md` with a per-surface matrix against the research note's high and medium findings (fixed, or residual with reason) and the before images from `.workflow/evidence/ui-prototype-fidelity/`.
- [ ] Send surface tasks with real gaps back via rework instead of patching their folders here.
- [ ] Rebuild the Linux AppImage, smoke-launch it in an isolated HOME under `xvfb-run`, and record path, size, and SHA-256 in `audit.md` (no binaries committed).
- [ ] Mark the spec done, write `.workflow/done/ui-polish/closeout.md`, archive this task, and land onto `main`.

## Progress
- Round 1 (base 7f69386): rework sent to 02, 03, 04, 06, 07 (feedback archived at /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/rework-feedback-round-1.md); all items verified fixed in round 2.
- Round 2 (base b6c68ff = integration 459965e merged into ui-polish/08): `NL_REPLAY=strict pnpm check` exit 0 (`Test Files 77 passed | 1 skipped (78)`, `Tests 1212 passed | 3 skipped (1215)`) after biome-formatting six gate-owned specs; `pnpm build` exit 0; full offline e2e under nl-headless 78 passed / 6 failed / 3 skipped — prototype-parity confirm eyebrow copy fixed in the gate spec; m4-single-instance flake (passes in batch); m4-gate W3 minimize, m4-import-illustrations intermittent hang, m3-text ruby clip reproduce on pre-polish baseline 87d0a4c; m5-share trash is gvfs-environmental (passes with HOME on the real fs). Leak sweep: 0 FIX NEEDED. Screenshots: 8 reworked surfaces recaptured light + dark. AppImage packaged and smoke-launched (pre-rework revision). Review r2 (`evidence/task08/review-r2.md`) plus the editor eyebrow finding → rework sent to 01, 02, 03, 04, 06 (/home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/rework-feedback.md).
