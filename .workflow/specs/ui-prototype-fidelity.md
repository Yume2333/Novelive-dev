# UI Prototype Fidelity

**Status:** done
**Accepted:** 2026-11-25 by agent (omp-vibe-windows)
**Priority:** high
**Integration branch:** ui-prototype-fidelity/integration

## What this is for

The prior `prototype-parity` pass only approximated outer page layouts while leaving most of `prototype/src/components/` unported. As a result, the production desktop UI still ships raw browser `<select>`, `<input type="checkbox">`, `<input type="radio">`, `<dialog>`, `<details>`, native `title` tooltips, unstyled tool JSON dumps, an empty editor stage, a read-only generic Bible dump, and missing overlay/feedback motion. Restore complete component, visual, and interaction parity with `prototype/src/` across the entire frontend while preserving all real creator/desktop backend contracts, i18n locales, and offline replay behavior.

## What it does

1. Ports the full `prototype/src/components/` control library and `prototype/src/styles/` tokens/utilities into `packages/ui/src/components/` and `packages/ui/src/styles/`, wired with `ToastProvider`, `usePresence` enter/exit motion, glass `Modal`/`Drawer`/`ConfirmDialog`/`Dropdown`/`Tooltip`, custom form controls (`TextInput`, `Textarea`, `Select`, `CompactSelect`, `Toggle`, `Checkbox`, `RadioGroup`, `Slider`, `SearchInput`, `TierPicker`, `Stepper`, `Pagination`), status visuals (`StatusPill`, `ChapterStatusMark`, `Banner`, `Chip`, `Skeleton`, `Spinner`), full `GradientCover`, and fixed `ScrollArea`/`OverlayScrollbar`.
2. Replaces all ad-hoc raw native controls and simplified layouts across every application surface (`AppShell`, `GlobalProductionQueue`, `Welcome`, `Library`, `Usage`, `Settings`, `Import`, `Work`, `ConfirmVisual`, `ConfirmFirst`, `Production`, `Editor`, `Bible`, `Player`, `AgentPanel`) so each surface matches `prototype/src/` in chrome, hierarchy, controls, overlays, and interactions.
3. Keeps every action backed by real `@novelive/creator/contract` and `window.novelive.host` APIs; never introduces mock data, fake no-op buttons, or hardcoded CSS colors violating `DESIGN.md` / Stylelint.

## How it is built

- **Foundation first (`01`).** Lock all shared primitives, styles, `ToastProvider`, and shared component locale keys in `packages/ui/src/components/`, `packages/ui/src/styles/`, `packages/ui/src/main.tsx`, and `packages/ui/src/locales/*/components.json`. Existing component exports remain compatible during transition.
- **Disjoint parallel surface waves (`02`–`07`).** Six independent tasks each own a strictly disjoint set of page/panel folders and their corresponding locale JSON files, consuming the locked control kit from `01` without modifying `components/`, `styles/`, or `packages/creator/`.
- **Single integration & packaging gate (`08`).** Runs full unit/lint/typecheck/E2E checks, captures matched-viewport `prototype` vs production screenshots in both light and dark themes, audits zero unintended raw native controls, updates broken implementation-detail E2E selectors cleanly, and rebuilds the Linux AppImage for owner testing.
- **Backend boundary honesty.** When a prototype affordance has a real backend command (`editor.regenerateImage`, `editor.selectImage`, `editor.saveRules`, `editor.history`, `production.resolveAsset`, `production.stop`, `production.retryChapter`, `production.prioritizeChapter`, `chat.*`, `config.update`, `host.share.*`, `host.about.*`, etc.), wire it end-to-end. When a prototype mock interaction has no backend command in `@novelive/creator/contract` (e.g. direct Bible field mutation without chat proposal, or pre-confirm visual regeneration), do not fake local-only persistence; document the exact backend capability gap in `.workflow/evidence/ui-prototype-fidelity/audit.md`.

## What it must not do

- Do not alter `@novelive/creator/contract` wire schemas or break offline `NL_REPLAY=strict` cassettes and existing backend tests.
- Do not introduce hardcoded hex/rgb/hsl color literals in `packages/ui/src/**/*.css` (outside `tokens.css`) or violate `DESIGN.md` (no native scrollbars, no `radius-full` text pills, no breathing status dots, no solid input focus outlines).
- Do not make paid model API calls.

## How we will know it works

- **W1.** `packages/ui/src/components/` exports and uses the complete prototype control kit (`Button`, `IconButton`, `Spinner`, `Card`, `StatusPill`, `ChapterStatusMark`, `ProgressBar`, `SectionLabel`, `Field`, `TextInput`, `Textarea`, `Select`, `CompactSelect`, `TierPicker`, `Toggle`, `Tabs`, `Banner`, `Chip`, `Tooltip`, `InfoTooltip`, `Checkbox`, `RadioGroup`, `Slider`, `SearchInput`, `Skeleton`, `Stepper`, `Drawer`, `ConfirmDialog`, `Pagination`, `Modal`, `Dropdown`, `ToastProvider`/`useToast`, `usePresence`, `Collapse`, `GradientCover`, `ScrollArea`/`OverlayScrollbar`, `Page`, `EmptyState`), and `packages/ui/src/pages/` + `shell/` + `panels/` contain zero unstyled native `<dialog>`, `<details>`, or raw checkbox/radio/select regressions outside intentional form wrappers.
- **W2.** `NL_REPLAY=strict pnpm check` passes on `ui-prototype-fidelity/integration` (`tsc`, Biome, Stylelint, full Vitest suite including i18n key/interpolation parity across `zh-CN`, `zh-TW`, `en`, `ja`).
- **W3.** `pnpm build` and offline Electron E2E suite (`NL_REPLAY=strict pnpm test:e2e`) pass on the integrated branch with all authoring, editing, bible, playback, share, and Agent routes working end-to-end.
- **W4.** Direct side-by-side comparison against `prototype/src/` at matching viewports in both light and dark themes (saved in `.workflow/evidence/ui-prototype-fidelity/`) confirms control, layout, typography, glass/paper texture, overlay, and interaction parity across all 14 surfaces (shell/queue, welcome, library, usage, settings, import, work, confirm-visual, confirm-first, production, editor, bible, player, agent), with an explicit parity matrix noting any backend-limited residuals.
- **W5.** `pnpm --filter @novelive/desktop run package:linux` produces a verified Linux AppImage on the integrated revision and launches cleanly for owner verification.
