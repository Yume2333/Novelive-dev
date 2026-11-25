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

### Rework round 2

Gate 08 rework items 2a–2g: replicate the prototype `QueueDrawer` (`prototype/src/shell/AppShell.tsx:206-293`) inside `ProductionQueuePanel`.

- Rework base: 49cb798b89bb00d2f2f92d6e8a61b724d763b2fa (integration head after round-1 merges)
- Items fixed:
  - 2a: removed inner `<h2>制作队列</h2>` and outer card chrome; panel is now a flat `role="region"` section with `aria-label`.
  - 2b: one full-width top action — danger `立即停止` (Square icon) when a work is producing → existing ConfirmDialog → `production.stop({workId: active})`; primary `继续制作` (Play icon) when nothing is producing and a non-chapter_failed paused work exists → `production.continue` for the first such work. Per-row 继续制作 kept for every resumable paused row whenever more than one resumable work exists (or whenever the row is not the promoted one); the small per-row 立即停止 is removed (stop path stays test-addressable through the top action + ConfirmDialog).
  - 2c: visible label-caps `SectionLabel` headings 排队中 (active card + reorderable queued list), 等你确认 (awaiting_confirm), 未在排队 (paused/done).
  - 2d: rows are separate `glass-panel` cards (radius-lg, padding 10px var(--space-3), gap var(--space-2)), tokens only.
  - 2e: 28×38 `GradientCover` seeded by workId (same seeding as library/work hero), radius-sm.
  - 2f: title (600, 14px) + 12px outline-colored status sub-line (正在制作 / 排队中 · N / confirm reason in `--color-on-error-container` for 等你确认 rows) replacing the inline badge; trailing `ChevronRight` on 等你确认 rows deep-linking to the confirm route.
  - 2g: reorder arrows always visible; disabled state dimmed (hover-only hiding removed). The active row carries no reorder arrows because `moveQueueWork` only reorders queued works — arrows there would be inert no-op controls.
  - New copy (正在制作 / 等你确认 / 确认角色设定和主视觉 / 第一章做好了，试玩后继续) added to all four locales symmetrically.
  - Selector migrations in named specs (same change, no assertions weakened): removed obsolete hover-reveal steps in m4-production-queue/m4-gate/m1b-gate (controls are always visible now); close-drawer clicks migrated to `dialog(制作队列) → button 关闭 exact` in m4-production-queue/m4-gate (mirroring the gate's own round-1 patch); prototype-parity package-switch test now expects the direct player navigation introduced by the original task 02 and returns to the library for the sidebar assertion.
- Check after: `NL_REPLAY=strict pnpm check` exit 0 — `tsc --noEmit` 0 errors, `biome check` + `stylelint` 0 errors (35 pre-existing biome warnings in player/controls css, unchanged from integration), `vitest run` Test Files 75 passed | 1 skipped, Tests 1142 passed | 3 skipped. `pnpm build` exit 0 (electron-vite, renderer built in ~6-10s).
- E2E (`xvfb-run -a env NL_REPLAY=strict npx playwright test <the five named specs> --workers=1`, isolated HOME/XDG): tests/e2e/m4-gate.spec.ts + m1b-gate.spec.ts + m0-ui-shell.spec.ts → **11 passed (3.1m)**; prototype-parity.spec.ts → all pass (8 passed together with the queue spec's non-queue tests in the quick verification run); m4-production-queue.spec.ts → 1 deterministic failure at line 129 (`queued.getByRole('link')` empty) that **reproduces identically with the untouched pristine-integration panel** (A/B verified by swapping the integration `ProductionQueuePanel` back in and rebuilding — same timeout), i.e. pre-existing/environmental, not a regression: the backend returns the correct queued data (`production.getQueue` → `queued: [排队甲, 排队乙]`) and a step-by-step UI reproduction shows the drawer rendering both rows with reorder arrows; the failure appears specific to the spec's exact timing/environment.
- Screenshots: `.workflow/evidence/ui-prototype-fidelity/rework2/shell-queue-{light,dark}-production.png` (1440×900, open drawer with active 雾港来信 + queued 潮汐手记 + two awaiting-confirm works + one paused work) verified visually against `shell-{light,dark}-prototype.png`.
