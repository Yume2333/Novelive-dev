# 02: Restore AppShell and GlobalProductionQueue drawer parity

**Effort:** ui-prototype-fidelity
**Blocked by:** 01
**Covers:** W1, W2, W4
**Files:** packages/ui/src/shell/, packages/ui/src/locales/*/shell.json
**Read first:** .workflow/specs/ui-prototype-fidelity.md, .workflow/research/ui-prototype-fidelity-audit.md, DESIGN.md, prototype/src/shell/AppShell.tsx, prototype/src/shell/theme.tsx
**Check:** `NL_REPLAY=strict pnpm check && NL_REPLAY=strict pnpm test:e2e --grep 'M0 desktop shell|M0 UI shell'` → check and shell Electron E2E pass with prototype-matched sidebar, Agent overlay motion, and queue Drawer.

- [ ] Upgrade `AppShell.tsx` + `AppShell.module.css`: add `-webkit-backdrop-filter` on glass sidebar; filter work sub-navigation by work kind (imported read-only packages show only 概览/游玩 and hide Novelive Agent trigger/shortcut); fix package selection in switcher to navigate directly instead of bouncing to `/`; reset main `ScrollArea` scrollTop on pathname change without remounting the entire scroll tree via `key`.
- [ ] Add `usePresence` enter/exit (`drawer-in`/`drawer-out`) motion to the Agent overlay container and wire Escape key handling (exit fullscreen first, then close Agent panel when no modal/drawer is open); expose page context label alongside `setAgentPosition` via outlet/shell context so pages can surface the `附带：{context}` chip in `AgentPanel`.
- [ ] Keep the 3-way theme segmented switch (`appearance.ts`) immediately interactive with local optimistic theme state even before backend `config.get` finishes or when config has errors, syncing back to `config.update` once ready.
- [ ] Replace `GlobalProductionQueue.tsx` native `<dialog>` with shared `Drawer`, add per-status icons (idle/producing/confirm/stopped) and chapter-level detail line in the sidebar status widget, add `ConfirmDialog` before destructive stop actions, and use `useToast` for queue reorder/stop/resume feedback.
- [ ] Update `packages/ui/src/locales/{zh-CN,zh-TW,en,ja}/shell.json` symmetrically for any added labels.
