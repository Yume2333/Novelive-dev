# 04: Restore player and Agent

**Effort:** prototype-parity
**Blocked by:** None
**Files:** packages/ui/src/pages/player/, panels/agent/
**Read first:** .workflow/specs/prototype-parity.md, DESIGN.md, prototype/src/
**Check:** `NL_REPLAY=strict pnpm check` passes; real Electron entry point matches the corresponding prototype with screenshot evidence.
**Covers:** W1, W2, W3, W4

- [x] Compare every assigned page directly with prototype.
- [x] Preserve real data and current working interactions.
- [x] Capture matched-viewport reference/result evidence and record residual differences.

## Progress

- Check after: covered by integrated `NL_REPLAY=strict pnpm check` green recorded in prototype-parity/05.
- Review: pass — covered by integrated second-round review PASS on 2026-11-24; checklist audited and fixed under PR #110 head `9171564a31`.
