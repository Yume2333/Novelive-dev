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
