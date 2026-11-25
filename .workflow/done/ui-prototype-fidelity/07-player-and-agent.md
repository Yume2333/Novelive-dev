# 07: Replicate Player overlays and AgentPanel with prototype controls and structured cards

**Effort:** ui-prototype-fidelity
**Blocked by:** 01
**Covers:** W1, W2, W4
**Files:** packages/ui/src/pages/player/, packages/ui/src/panels/agent/, packages/ui/src/locales/*/player.json, packages/ui/src/locales/*/agent.json
**Read first:** .workflow/specs/ui-prototype-fidelity.md, .workflow/research/ui-prototype-fidelity-audit.md, DESIGN.md, prototype/src/pages/player/PlayerPage.tsx, prototype/src/pages/player/player.css, prototype/src/pages/chat/ChatPanel.tsx, prototype/src/pages/chat/MessageView.tsx
**Check:** `NL_REPLAY=strict pnpm check && NL_REPLAY=strict pnpm test:e2e --grep 'M3 controls|M3 stage|M3 custom marks|M2 chat'` → check and Player/Chat Electron E2E specs pass with zero native `<dialog>`/`<details>`/raw checkbox regressions.

- [x] **Player interactions & chrome (`pages/player/`)**: restore mouse-wheel up/down rollback & advance, `PageUp`/`PageDown` shortcuts, entry black-veil fade (`nl-enter-veil`), top-left `重看` pill badge in reread mode, bobbing next-glyph chevron when line finishes typing, and paper-style inner white highlight + noise texture in `player.css` / `controls.css`.
- [x] **Player menus, save/load, settings & chapter-end (`pages/player/controls/`)**: show actual work title in system menu + exit `ConfirmDialog` ("返回作品页？"); include quick-save slot card with `快速` badge + line-text excerpt in Save/Load grid; add chapter preview thumbnails in Chapters overlay; replace raw checkboxes/ranges in Settings with shared `Toggle` and `Slider` (with suffix readout); upgrade chapter-end overlay to full prototype `waitEnd` (with `ProgressBar`), `nextReady`, and `finale` (返回作品页 / 重新播放) screens.
- [x] **AgentPanel composer & attachments (`panels/agent/Composer.tsx`, `AgentPanel.tsx`)**: keep expand/collapse button always visible top-right of composer with smooth height transition (`var(--dur-base)`) and Escape-to-collapse before panel close; render detachable `附带：{context}` `Chip` above composer when page context is active; apply `.nl-img-thumb` + `.nl-img-thumb-mask` hover zoom icon overlay on pending & sent thumbnails; replace native `<dialog>` lightbox with shared `Modal` showing image title/name.
- [x] **AgentPanel message rendering (`panels/agent/MessageView.tsx`)**: upgrade `ThinkingBlock` with live elapsed timer + `ink-shimmer` while streaming; replace raw JSON `<pre>` dumps in `ToolCard` with prototype's structured card (status icon/`Spinner`, caps label with shimmer, formatted label/value args, check rows, image preview, error styling, collapsible raw details only via `Collapse`); make `SubtaskCard` expandable with nested rendered parts; add streaming `ink-shimmer` + `.typing-caret` indicator; upgrade `ProposalCard`/`ConfirmCard` with kind icon+chip header, general before/after diff preview, and `ConfirmDialog` for destructive kinds; replace raw `<details>` `SummaryDivider` with prototype divider + `Collapse`.
- [x] Sync all new i18n keys across `zh-CN`, `zh-TW`, `en`, `ja` `player.json` and `agent.json`.

## Progress

- Base commit: 769f6e3340b2d1bd86e282ba0b252b196db821da
- Check after: pnpm check exit 0 (Test Files 75 passed | 1 skipped (76); Tests 1142 passed | 3 skipped (1145)); e2e --grep 'M3 controls|M3 stage|M3 custom marks|M2 chat' with --workers=1: 4 passed, exit 0 (two consecutive runs; 3-worker runs are flaky on m3-stage canvas-width assertion due to resize race under Xvfb, baseline uip-integration passes with 1 worker)
- Note: tests/e2e/m3-controls.spec.ts ('M3 player controls', not matched by the grep) has unscoped getByRole('status') assertions that collide with the empty ToastProvider role=status stack added by base task 01 (packages/ui/src/components/Toast.tsx); outside window 07 ownership.
- Review: pass (base 769f6e3340b2d1bd86e282ba0b252b196db821da, reviewer reviewer-07)

### Rework round 1 (gate 08 feedback 7a/7b/7c)

- Rework base commit: 3568aa2784353c8164f449957afc33332f9d99b2
- 7a: overlay Tab trap (`PlayerControls.tsx`) no longer excludes `.nl-focus-skip`; save pagination is keyboard-reachable (initial-focus selector still skips it).
- 7b: `ProgressPanel` `chapters` optional, defaults to `[]`; embedders without chapters (legacy-save fixture) render again.
- 7c: entry veil removed as soon as the first `.nl-text-display` mounts (1250 ms fallback); `.nl-end-overlay` scrim/blur and `.nl-end-card` shadow removed so chapter-end stage pixels stay untouched; ruby gets `line-height: 2` so annotations stay inside their line box for the pagination clip (trial matrix: 1.8 fails clip 3/3, 1.9 and 2.0 pass 9/9). m3-text clip failure reproduced at pre-fidelity base 3a8ba3b, fixed here anyway.
- Check after: `NL_REPLAY=strict pnpm check` exit 0 (Test Files 75 passed | 1 skipped (76); Tests 1142 passed | 3 skipped (1145)); with gate 08 test-selector patch applied temporarily: m3-controls + m3-text + m3-gate + m1b-player + m5-share + m5-share-ui + m2-chat `--workers=1`: 17 passed / 1 failed, the failure being the m1b-player.spec.ts:57 `setContentSize` resize-handshake timeout, which reproduces at the same rate (1/8) on base 3a8ba3b; m1b-player + m3-text + m5-share otherwise pass (6/6 in repeated runs); brief check on clean tree: 4 passed (28.7s).
- Review: pass after fix (base 3568aa2784353c8164f449957afc33332f9d99b2, reviewer uip07-review; SHOULD-FIX ruby 2.4 → 2 applied; nits on veil timing accepted as intentional).

### Rework round 2 (gate 08 feedback 7a/7b player, 7c/7d/7e agent)

- Rework base commit: 14fbf824e95c624b0398a7b067cc9e4dbe8784d0
- 7a: player soft dialogue is the prototype's tall transparent→dark gradient again (`min-height` 34%, text padding-top 8.5vh ≈ prototype's 25% text start, `transparent → --stage-scrim 82%/primary 68% → --stage-frame` at the user dialogue-opacity end alpha); the separate 6vh `::before` fade is gone (the gradient is the fade), accent hairline kept at `top: 15%` inside the band. `.nl-text-viewport` geometry untouched.
- 7b: next-glyph chevron no longer pinned at `right: 9%`; `NextGlyph` measures the last revealed glyph in `.nl-text-display` and anchors inline after the text end, vertically centered on the glyph line box, repositioned by MutationObserver + resize in `useLayoutEffect` (no first-paint flash, no clip-audit interference since it lives outside the text viewport); accent colour per prototype, hidden in hidden-UI mode.
- 7c: agent session header rename uses the prototype's inline submit control; 7d: composer send is the lucide `Send` icon button; 7e: agent tool cards render localized titles (e.g. `读取设定集` instead of raw `read_bible`).
- Test migrations (named specs only, no assertion weakened):
  - m3-stage composite audit (`合成基准`/`合成演出`) was premised on the opaque slab and is the one place where gate 08's "no E2E samples the bottom overlay region" does not hold; verified red only with the gradient, green on unmodified base. Migrated to exact frame-to-frame byte stability of the panel in the static scene, and for particles a sparse-and-faint bound (<2% of channel samples deviating >8 from the no-particle baseline; measured ~0.4%, so 5× headroom — a scrim loss or particle-layer regression produces contiguous massive deviation).
  - m3-controls: 7 unscoped `getByRole('status')` assertions scoped to `.nl-player` because the always-present empty ToastProvider `role="status"` stack collides in strict mode (known since round 1; same elements, same expected text — verified the same 3 tests fail identically on unmodified base).
  - m2-chat + prototype-parity: tool-card selector migrated `read_bible` → localized `读取设定集` following 7e.
- Triage note: prototype-parity.spec.ts:139 sidebar test failure at line 204 (expected `#/`, got `#/package/<id>/3`) is pre-existing — reproduced byte-identical on clean HEAD via `git stash -u` + rebuild (stash pop restored the tree exactly).
- Check after: `NL_REPLAY=strict pnpm check` exit 0 (typecheck 0 errors; lint exit 0; Test Files 75 passed | 1 skipped (76); Tests 1142 passed | 3 skipped (1145)); `xvfb-run -a env NL_REPLAY=strict npx playwright test tests/e2e/m1b-player.spec.ts tests/e2e/m3-text.spec.ts tests/e2e/m3-stage.spec.ts tests/e2e/m5-share.spec.ts tests/e2e/m3-controls.spec.ts --workers=1` exit 0: 15 passed, 0 failed. Light/dark player evidence with text showing captured at `.workflow/evidence/ui-prototype-fidelity/rework2/player-{light,dark}.png` (gradient + inline chevron vision-verified).
- Review: pass (base 14fbf824e95c624b0398a7b067cc9e4dbe8784d0, reviewer reviewer-07)
