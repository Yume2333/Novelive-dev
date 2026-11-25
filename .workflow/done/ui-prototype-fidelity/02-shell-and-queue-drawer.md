# 02: Restore AppShell and GlobalProductionQueue drawer parity

**Effort:** ui-prototype-fidelity
**Blocked by:** 01
**Covers:** W1, W2, W4
**Files:** packages/ui/src/shell/, packages/ui/src/locales/*/shell.json
**Read first:** .workflow/specs/ui-prototype-fidelity.md, .workflow/research/ui-prototype-fidelity-audit.md, DESIGN.md, prototype/src/shell/AppShell.tsx, prototype/src/shell/theme.tsx
**Check:** `NL_REPLAY=strict pnpm check && NL_REPLAY=strict pnpm test:e2e --grep 'M0 desktop shell|M0 UI shell'` → check and shell Electron E2E pass with prototype-matched sidebar, Agent overlay motion, and queue Drawer.

- [x] Upgrade `AppShell.tsx` + `AppShell.module.css`: add `-webkit-backdrop-filter` on glass sidebar; filter work sub-navigation by work kind (imported read-only packages show only 概览/游玩 and hide Novelive Agent trigger/shortcut); fix package selection in switcher to navigate directly instead of bouncing to `/`; reset main `ScrollArea` scrollTop on pathname change without remounting the entire scroll tree via `key`.
- [x] Add `usePresence` enter/exit (`drawer-in`/`drawer-out`) motion to the Agent overlay container and wire Escape key handling (exit fullscreen first, then close Agent panel when no modal/drawer is open); expose page context label alongside `setAgentPosition` via outlet/shell context so pages can surface the `附带：{context}` chip in `AgentPanel`.
- [x] Keep the 3-way theme segmented switch (`appearance.ts`) immediately interactive with local optimistic theme state even before backend `config.get` finishes or when config has errors, syncing back to `config.update` once ready.
- [x] Replace `GlobalProductionQueue.tsx` native `<dialog>` with shared `Drawer`, add per-status icons (idle/producing/confirm/stopped) and chapter-level detail line in the sidebar status widget, add `ConfirmDialog` before destructive stop actions, and use `useToast` for queue reorder/stop/resume feedback.
- [x] Update `packages/ui/src/locales/{zh-CN,zh-TW,en,ja}/shell.json` symmetrically for any added labels.

## Progress

- Base commit: 769f6e3340b2d1bd86e282ba0b252b196db821da
- Check after: `NL_REPLAY=strict pnpm check && xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M0 desktop shell|M0 UI shell'` passed (exit 0) — `tsc --noEmit` 0 errors, `biome check` + `stylelint` 0 errors, `vitest run` 75 passed | 1 skipped (1142 passed | 3 skipped), `electron-vite build` succeeded, `M0 desktop shell|M0 UI shell` 2 passed (3.6s); standalone `tests/e2e/m0-ui-shell.spec.ts` 2 passed (3.2s).
- Review: pass (base 769f6e3340b2d1bd86e282ba0b252b196db821da, reviewer shell-reviewer)
