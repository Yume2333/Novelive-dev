# 01: Restore shell and global pages

**Effort:** prototype-parity
**Blocked by:** None
**Files:** packages/ui/src/shell/, components/, styles/, main.tsx, pages/library/, settings/, usage/, welcome/
**Read first:** .workflow/specs/prototype-parity.md, DESIGN.md, prototype/src/
**Check:** `NL_REPLAY=strict pnpm check` passes; real Electron entry point matches the corresponding prototype with screenshot evidence.
**Covers:** W1, W3, W4

- [ ] Compare every assigned page directly with prototype.
- [ ] Preserve real data and current working interactions.
- [ ] Capture matched-viewport reference/result evidence and record residual differences.
