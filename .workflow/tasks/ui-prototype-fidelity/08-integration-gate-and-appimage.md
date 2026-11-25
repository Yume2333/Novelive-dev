# 08: Full integration verification, side-by-side prototype audit, and Linux AppImage build

**Effort:** ui-prototype-fidelity
**Blocked by:** 02, 03, 04, 05, 06, 07
**Covers:** W1, W2, W3, W4, W5
**Files:** tests/, .workflow/evidence/ui-prototype-fidelity/
**Read first:** .workflow/specs/ui-prototype-fidelity.md, .workflow/research/ui-prototype-fidelity-audit.md, DESIGN.md, .workflow/standards.md
**Check:** `NL_REPLAY=strict pnpm check && NL_REPLAY=strict pnpm test:e2e && pnpm --filter @novelive/desktop run package:linux` → full typecheck/lint/unit suite, Electron E2E suite, native-control audit, matched-viewport prototype vs production screenshot audit in light & dark themes, and Linux AppImage packaging all pass.

- [ ] Run an automated static audit verifying `packages/ui/src/components/` exports the full prototype control kit and `packages/ui/src/{pages,shell,panels}/` contain zero unintended native `<dialog>`, `<details>`, bare `<select>`, or unstyled `<input type="checkbox|radio">` regressions; record audit output in `.workflow/evidence/ui-prototype-fidelity/control-audit.txt`.
- [ ] Run `NL_REPLAY=strict pnpm check` and full offline Electron E2E (`NL_REPLAY=strict pnpm test:e2e`); fix any contract/selector breakages cleanly without weakening assertions (and never suppress real UI regressions).
- [ ] Capture matched-viewport side-by-side screenshots (`prototype/src/` vs production Electron in both light and dark themes) for all 14 surfaces (shell/queue, welcome, library, usage, settings, import, work, confirm-visual, confirm-first, production, editor, bible, player, agent) under `.workflow/evidence/ui-prototype-fidelity/` and write `.workflow/evidence/ui-prototype-fidelity/audit.md` with a per-page parity matrix and any explicit backend-limited residuals.
- [ ] Run `pnpm --filter @novelive/desktop run package:linux` (using Node 24.22.3) and smoke-launch the built Linux AppImage to verify packaged UI rendering, theme switching, and navigation; record AppImage path, size, and SHA-256 in `.workflow/evidence/ui-prototype-fidelity/audit.md`.
