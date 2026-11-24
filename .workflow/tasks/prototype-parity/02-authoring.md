# 02: Restore authoring flow pages

**Effort:** prototype-parity
**Blocked by:** None
**Files:** packages/ui/src/pages/import/, work/, production/, confirm/
**Read first:** .workflow/specs/prototype-parity.md, DESIGN.md, prototype/src/
**Check:** `NL_REPLAY=strict pnpm check` passes; real Electron entry point matches the corresponding prototype with screenshot evidence.
**Covers:** W1, W2, W3

- [x] Compare every assigned page directly with prototype.
- [x] Preserve real data and current working interactions.
- [x] Capture matched-viewport reference/result evidence and record residual differences.

## Progress

- Check after: `NL_REPLAY=strict pnpm check` on `fa78852` passed: `68 passed | 1 skipped (69)` test files and `1063 passed | 3 skipped (1066)` tests. Serial Electron E2E covering m1b-creation-ui, m1b-gate, m1b-wizard, m4-epub-screening and m4-import-illustrations passed `12 passed (47.7s)`. The real Electron entry point and the prototype were captured in light and dark at 1280 × 1000. Evidence and the residual-difference audit are in [authoring-flow](../../evidence/prototype-parity/authoring-flow/audit.md).
- Import is three steps (选择文件 → 核对信息 → 改编设置). Draft state carries through steps 2 and 3, and step 3 sends one `import.revise`. Export moved into the work page's `更多` menu. The m4-import-join and m5-share locator deltas are handed to the parent.
- m4-gate `:503` (已发生用量 region) and `:892` (tray window visibility) also fail on integration base `1bae8aa` without these changes.
- Review: skipped — parent fresh integration review pending
