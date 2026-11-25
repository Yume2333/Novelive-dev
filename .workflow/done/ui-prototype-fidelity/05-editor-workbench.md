# 05: Replicate Editor workbench with prototype stage, overlays, and controls

**Effort:** ui-prototype-fidelity
**Blocked by:** 01
**Covers:** W1, W2, W4
**Files:** packages/ui/src/pages/editor/, packages/ui/src/locales/*/editor.json
**Read first:** .workflow/specs/ui-prototype-fidelity.md, .workflow/research/ui-prototype-fidelity-audit.md, DESIGN.md, prototype/src/pages/editor/EditorPage.tsx
**Check:** `NL_REPLAY=strict pnpm check && NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor|M2 gate'` → check and editor Electron E2E pass with live static stage, preview controls, prototype modals/drawers, and zero raw native dialog/select regressions.

- [x] **Live stage & preview (`EditorPage.tsx`, `editor.css`)**: render a live static stage immediately on load (resolved real background or stage gradient, cast portraits/silhouettes with speaking vs dimmed brightness, speaker·expression chips, top-left scene title chip, top-right `n / total` position chip, prev/next line edge chevrons, and styled dialogue/caption overlay with rich-text marks — replacing the blank surface and broken white box). Add floating 暂停/继续/停止 pill controls + Escape-to-stop during preview playback, returning cleanly to the static stage on stop; add `skeleton-wave` shimmer overlay on stage during image regeneration.
- [x] **Stage footer & image regen (`SceneImages.tsx`)**: replace the raw dark `<select>` + inline input/buttons bar with prototype's stage-dark footer (`背景 · ...` / `立绘 · ...` + `Dropdown` split button for 出一张直接替换 / 多出几张再挑, plus optional instruction input inside regen modal/popover) and a 3-column candidate picker `Modal` wired to `editor.regenerateImage` and `editor.selectImage`.
- [x] **Toolbar, history drawer & rules modal (`EditorPage.tsx`, `EditorPanels.tsx`)**: replace bare `<select>` chapter/scene pickers with `CompactSelect`; move `修改历史` and `存为规则` out of floating bottom buttons into a header `Dropdown` ("更多") opening a 380px `Drawer` (with time/change-count glass cards and `EmptyState`) and a `Modal` (with `RadioGroup` scope, `Textarea`, info `Banner`, and hover-delete rule list wired to `editor.saveRules`); restore redo stack (`Ctrl/⌘+Shift+Z` / `Ctrl+Y`) alongside global `Ctrl/⌘+Z` undo.
- [x] **Sentence list, source panel & rewrite modal (`SentenceList.tsx`, `EditorPage.tsx`)**: add per-line hover-revealed "问 Agent" `IconButton` (selects line, sets context label + `setAgentPosition`, opens Agent panel), ArrowUp/ArrowDown keyboard line navigation, "更多标记" `Dropdown` grouping for secondary marks, and per-paragraph "让 Agent 按这段修改" hover action + line jump in SourcePanel. Replace native `<dialog>` rewrite UI with `Modal` + `Checkbox` + rich-text diff cards (kind/speaker caps, struck old vs new text, `skeleton-wave` loading state, selected hunk count in CTA).
- [x] **Deep link fix**: honor `chapterId`, `sceneId`, and `lineId` query params emitted by `routes/player.ts` when opening the editor from the player's "在编辑器中打开这里".
- [x] Sync all new i18n keys across `zh-CN`, `zh-TW`, `en`, `ja` `editor.json`.

## Progress
- Base commit: 769f6e3340b2d1bd86e282ba0b252b196db821da
- Check after: `NL_REPLAY=strict pnpm check` exit 0 (vitest 75 files passed | 1 skipped, 1142 tests passed | 3 skipped); `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M2 editor|M2 gate'` -> 9 passed; additionally `--grep 'M2 revise a work'` (tests/e2e/m2-gate.spec.ts) passes after migrating stale selectors. Full `pnpm test:e2e`: 74 passed, 8 failed, 3 skipped; the failures are in m1b-gate, m1b-production-contract, m3-controls, m3-custom-marks, m3-stage, m3-text (player/production/Toast-status landmark specs, no editor involvement) and are left to task 08 gate.
- Review: pass (base 769f6e3340b2d1bd86e282ba0b252b196db821da, reviewer editor-reviewer)
- Note: tests/e2e/m2-editor.spec.ts and m2-gate.spec.ts selectors migrated to the new controls (selector/gesture-only, no assertions removed).
