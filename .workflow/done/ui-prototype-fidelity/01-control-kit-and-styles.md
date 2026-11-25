# 01: Port complete prototype control kit and global styles

**Effort:** ui-prototype-fidelity
**Blocked by:** None
**Covers:** W1, W2
**Files:** packages/ui/src/components/, packages/ui/src/styles/, packages/ui/src/main.tsx, packages/ui/src/locales/*/components.json
**Read first:** .workflow/specs/ui-prototype-fidelity.md, .workflow/research/ui-prototype-fidelity-audit.md, DESIGN.md, prototype/src/styles/base.css, prototype/src/components/
**Check:** `NL_REPLAY=strict pnpm check && pnpm build` → typecheck, Biome, Stylelint, all unit tests (including new control-kit unit tests and locale parity), and desktop Vite build pass with zero errors.

- [x] Restore `styles/shell.css`, `styles/base.css`, `styles/tokens.css`, and `components/ScrollArea.module.css` parity with `prototype/src/styles/`: `background-attachment: fixed`, `-webkit-font-smoothing: antialiased`, focus/hover `!important` guards, remove conflicting generic `:focus-visible` ring on `input`/`select`/`textarea`, add `--cover-author` token, restore `ScrollArea` track `z-index: 6`, `:focus-within` visibility, and `4px -> 5px` thumb width transition.
- [x] Port `Motion.tsx` (`usePresence`, `Collapse`), `Toast.tsx` (`ToastProvider`, `useToast`), `Modal.tsx` (`Modal` portal with blurred scrim + `usePresence` + click-outside/Escape + `ScrollArea` body + footer; upgrade `Dropdown` with `usePresence` exit animation; rebase `ShareDialog` onto `Modal`).
- [x] Port `Form.tsx` (`Field`, `inputStyle`, `textareaStyle`, `TextInput`, `Textarea`, `Select`, `CompactSelect` with custom chevron & `appearance: none`, `TierPicker`, `Toggle`, keeping `Tabs` ARIA support).
- [x] Port `Extended.tsx` (`Banner`, clickable `Chip`, generic portaled `Tooltip` + `InfoTooltip` built on it, `Checkbox` with `.nl-check-input`/`.nl-check-box`, `RadioGroup`, `Slider` with suffix readout, `SearchInput`, `Skeleton`, `Stepper`, `Drawer` portal with blurred scrim + `drawer-in/out`, `ConfirmDialog`, `Pagination`).
- [x] Upgrade `Button.tsx` (`Button`, `IconButton` with `size`/`iconSize`, exported `Spinner`), `Card.tsx` (auto `nl-card-interactive` + keyboard Enter/Space on `onClick`, `StatusPill`, `ChapterStatusMark`, `statusMeta`, `attentionMeta`, `ProgressBar`, `SectionLabel`), and `GradientCover.tsx` (author line, `style` prop, lighthouse motif, explicit gradient/motif override).
- [x] Export a clean barrel `packages/ui/src/components/index.ts`, wire `<ToastProvider>` in `packages/ui/src/main.tsx`, keep all existing caller imports compiling, add any new shared component locale strings across all 4 locales (`zh-CN`, `zh-TW`, `en`, `ja`), and add focused unit tests covering modal/drawer/confirm/toggle/checkbox/radio/select/toast/presence interactions.

## Progress

- Base commit: 3a8ba3bbb97d4c78d2f7ea6ad9b1f27218378176
- Check after: `NL_REPLAY=strict pnpm check && pnpm build` passed (exit 0) — `tsc --noEmit` 0 errors, `biome check` + `stylelint` 0 errors, `vitest run` 75 passed | 1 skipped (1142 passed | 3 skipped, including 32 control-kit tests and 6 locale parity tests), `electron-vite build` succeeded (main/preload/renderer).
- Review: pass (base 3a8ba3bbb97d4c78d2f7ea6ad9b1f27218378176, reviewer reviewer-01)

### Rework round 2

- Rework base commit: 14fbf824e95c624b0398a7b067cc9e4dbe8784d0
- Fix: removed Drawer scrim `backdrop-filter: blur(4px)` and `-webkit-backdrop-filter: blur(4px)` from `.drawerScrim` in `packages/ui/src/components/Extended.module.css` per gate 08 feedback 1a; `background: var(--scrim)` and `.drawerScrimEnter/.drawerScrimExit` presence animations kept; Modal blur untouched. No unit test under tests/unit asserts drawer scrim blur.
- Check after: `NL_REPLAY=strict pnpm check` exit 0 — `Test Files 75 passed | 1 skipped (76)`, `Tests 1142 passed | 3 skipped (1145)` (first run hit pre-existing flake in `tests/integration/m1b-offline-dry-run.test.ts > concurrent-sunburst`; same spec passed 31/31 on clean baseline rerun and full check passed on rerun with the fix). `pnpm build` exit 0 (`electron-vite build` main/preload/renderer, `✓ built in 4.59s`).
- Playwright: `xvfb-run -a env NL_REPLAY=strict … npx playwright test tests/e2e/m4-production-queue.spec.ts tests/e2e/m0-ui-shell.spec.ts --workers=1` → `1 failed (m4-production-queue, test timeout 30000ms exceeded), 2 passed (m0-ui-shell, 43.0s)`. m4 failure is pre-existing and unrelated: isolated rerun failed identically, and the same spec fails identically on clean baseline without this change (both in uip-01 and in the uip-integration worktree at 14fbf82).
