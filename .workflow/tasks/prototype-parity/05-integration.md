# 05: Verify integrated prototype parity

**Effort:** prototype-parity
**Blocked by:** 01, 02, 03, 04
**Files:** tests/e2e/, .workflow/evidence/prototype-parity/
**Read first:** .workflow/specs/prototype-parity.md, DESIGN.md, prototype/src/
**Check:** `NL_REPLAY=strict pnpm check` passes; real Electron entry point matches the corresponding prototype with screenshot evidence.
**Covers:** W1, W2, W3, W4

- [ ] Compare every assigned page directly with prototype.
- [ ] Preserve real data and current working interactions.
- [ ] Capture matched-viewport reference/result evidence and record residual differences.

## Progress

- Review: blocked (base c7b30eb8beb07f87343cb993cb7827c80fa62ee0, reviewer devin-f62c44a85d344e78aaf554cffbe53512)
- The first independent visual review found seven blocking parity gaps. All four area sessions are fixing one combined batch; the final integrated revision and replacement receipts require the second and final review round before landing.
- Strict offline check on ce4c00a passed (68 test files, 1073 tests; one file and three tests skipped). Build passed. Onboarding preserves independent model providers, selected production chapter routing reaches the player, and import/share flows use the prototype-aligned controls.
- The editor now reads its chapter catalog through the existing read-only player status command, avoiding production-session initialization. Final full Electron checks and UI-driven acceptance remain pending after all area fixes are integrated.
