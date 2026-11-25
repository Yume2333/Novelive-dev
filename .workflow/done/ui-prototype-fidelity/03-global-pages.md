# 03: Replicate Welcome, Library, Usage, and Settings pages with prototype controls

**Effort:** ui-prototype-fidelity
**Blocked by:** 01
**Covers:** W1, W2, W4
**Files:** packages/ui/src/pages/welcome/, packages/ui/src/pages/library/, packages/ui/src/pages/usage/, packages/ui/src/pages/settings/, packages/ui/src/locales/*/welcome.json, packages/ui/src/locales/*/library.json, packages/ui/src/locales/*/usage.json, packages/ui/src/locales/*/settings.json
**Read first:** .workflow/specs/ui-prototype-fidelity.md, .workflow/research/ui-prototype-fidelity-audit.md, DESIGN.md, prototype/src/pages/welcome/WelcomePage.tsx, prototype/src/pages/library/LibraryPage.tsx, prototype/src/pages/usage/UsagePage.tsx, prototype/src/pages/settings/SettingsPage.tsx
**Check:** `NL_REPLAY=strict pnpm check && NL_REPLAY=strict pnpm test:e2e --grep 'M5 share UI|M5 locales|M0 UI shell'` → check and relevant Electron E2E specs pass with zero raw native select/checkbox/dialog regressions across these four pages.

- [x] **Welcome (`pages/welcome/`)**: replace raw inputs/selects/notices with `Field`, `TextInput`, `Select`, `Tooltip` (removing native `title` help span), `Banner` for player-mode note, styled success/error test-connection chips with icons and `fade-in`, and `useToast` on entering library.
- [x] **Library (`pages/library/`)**: restore per-phase status lines and colors (preview/confirm-visual/confirm-first/producing+attention/done), confirm-point & version `Chip`s, `ProgressBar active` sheen with current-step / reading-progress caption, series `collections_bookmark` icon + primary color, icon on 导入作品包 `Button`, two-CTA `EmptyState` (新建工程 + 导入作品包 + 重看引导), hover-row `Dropdown` + `ConfirmDialog` for imported-package actions, and upgrade `ImportPackage.tsx` to prototype's structured `Modal` (icon tile, filename, version/source meta, warning `Banner`, migration details).
- [x] **Usage (`pages/usage/`)**: replace native `title` bar tooltips with a portaled glass hover/focus tooltip card (day, calls/tokens/images, cost, edge-aware positioning, active bar highlight), replace all bare `<select>` with `CompactSelect`, and apply canonical glass input styling (`--shadow-glass`) to date/month range inputs.
- [x] **Settings (`pages/settings/`)**: replace every bare `<select>` with `CompactSelect`/`Select` and raw `<input type="checkbox">` with `Checkbox`/`Toggle`; restore `.hover-row` writer preset rows with hover-revealed actions (设为默认/编辑/复制/删除) + `ConfirmDialog` on delete; move `WriterPresetEditor` into `Modal` (width 560, arrow icon between find/replace, icon delete buttons); restore structured visual/image capability test result cards; add external icons + in-app third-party licenses `Modal` table in About section alongside host links; emit `useToast` feedback on save/copy/delete/reset.
- [x] Sync all new i18n keys across `zh-CN`, `zh-TW`, `en`, `ja` locale files.

## Progress

- Base commit: 769f6e3340b2d1bd86e282ba0b252b196db821da
- Check after: `NL_REPLAY=strict pnpm check` → exit 0 (tsc + biome 0 errors + stylelint 0 errors + Vitest 75 passed / 1 skipped, 1142 passed / 3 skipped); `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M5 share UI|M5 locales|M0 UI shell'` → exit 0 (1 passed; title-grep only matches `m5-locales`); `xvfb-run -a env NL_REPLAY=strict pnpm exec playwright test tests/e2e/m5-share-ui.spec.ts tests/e2e/m5-share.spec.ts tests/e2e/m5-locales.spec.ts tests/e2e/m0-ui-shell.spec.ts tests/e2e/m0-settings.spec.ts` → exit 0 (13/13 passed)
- Review: pass (base 769f6e3340b2d1bd86e282ba0b252b196db821da, reviewer worker-reviewer) — blocking E2E regressions B1 (duplicate empty-state `新建工程` link) & B2 (import toast duplicating modal `role="status"` copy) plus minor polish M1/M2/M5/M6/M7/M8 all resolved and re-verified PASS.
- Backend capability gaps (for gate 08 audit):
  - Library imported-package `Dropdown` + `ConfirmDialog` (remove / import-as-project): `host.installed` only exposes `list`/`chapter`/`takeOpenFile` (no uninstall and no archive path); omitted rather than adding fake no-ops.
  - Library producing current-step caption & preview progress: `production.getQueue` exposes no per-chapter step or preview `done/total`.
  - Settings `VisualTestResult`: `model.testText` returns `{ok: true}` with no image description text.
  - Settings About `第三方许可` in-app Modal is always available (with `打开完整文本` calling `host.about.open('notices')` when packaged); `tests/e2e/support/m5-locales-surface.ts:147` asserts `toHaveCount(0)` in dev and should be updated in gate 08.
