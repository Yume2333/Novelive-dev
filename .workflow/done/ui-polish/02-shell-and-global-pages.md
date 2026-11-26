# 02: Shell, welcome, library, usage, and settings polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/shell/, packages/ui/src/pages/{welcome,library,usage,settings}/, packages/ui/src/locales/*/{shell,welcome,library,usage,settings,main}.json, tests/e2e/{m0-shell,m0-ui-shell,m0-settings,m4-usage,m4-tray,m5-locales,m5-share-ui}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「App Shell & Global Pages」, DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M0 desktop shell|M0 UI shell|M0 settings|M4 usage|M5 locales|M5 share UI'` pass.

- [x] **Leaks** L1–L12: no volume ids, project ids, work UUIDs, or asset keys anywhere. `AppShell` falls back to `formatWorkTitle`; library group headings and settings paths use `formatPath`; usage money uses `formatCost`; the model id is secondary text, not the bold lead; the model card summary shows only the model name (the format moves into the expanded editor); the 「日志」 button becomes 「查看诊断信息」.
- [x] **Usage page** (maintainer decision): replace the per-call 「已发生用量」 list with per-day and per-model aggregates; delete the 「过期素材」 section; wrap the 「部分项目无法读取」 warning in `Banner kind="warning"` with humanized entries; localize the date-range inputs to the UI language (use the shared control or set `lang`); trim the info tooltip to billing facts only; give bar-chart bars a real role or make them non-interactive; fix the negative-margin spacing hack against `DESIGN.md` spacing.
- [x] **Style** S1–S13: every error/load state uses `ErrorNotice`/`LoadingState`; one `EmptyState` convention (no double `Card` wrapper); settings and library cards compose the shared `Card`; one card radius; type tokens replace 13.5px and other off-scale sizes; welcome model setup reuses the settings model field components (including 「兼容哪家」) with its simpler layout; `font` shorthand unified.
- [x] **UX** U1–U14: one progress line on library cards (published vs read made distinct or merged per the prototype); unplayable imported works explain why they aren't clickable; the 「有 n 部作品无法读取」 notice gives a reason and an action; the work switcher is discoverable and its items are grouped (projects / packages) with consistent labels; the queue drawer shows no duplicate 「制作队列」 heading, keeps the stop confirmation readable, and has row cover thumbnails; About section rhythm and icons are consistent; production role rows drop the repeated meaningless icon; welcome step 2 explains in one line what the models are for; one step indicator component.
- [x] Sync all four locales and update the listed e2e specs where intended copy or DOM changed; never weaken an assertion.

## Progress

Base commit: 3765fcb805ec811299e48501d04e9ef354dc20ab
Check before: n/a (new polish work)
Check after: `NL_REPLAY=strict pnpm check` exit 0 — lint 33 warnings / 2 infos / 0 errors; vitest Test Files 76 passed | 1 skipped (77), Tests 1195 passed | 3 skipped (1198), duration 168s. `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M0 desktop shell|M0 UI shell|M0 settings|M4 usage|M5 locales|M5 share UI'` exit 0 — Playwright 11 passed (14.8s), 0 failed.
Review: pass (base 3765fcb805ec811299e48501d04e9ef354dc20ab, reviewer reviewer-02)
The reviewer's findings (quietLead wiring, grouped unreadable banner, ApiKeyInput reuse, welcome negative margin, zh-TW 空閒) were fixed and re-checked.

### Rework (gate 08)

- `AppShell.tsx` hostError bespoke `<p className={styles.warning} role="alert">` replaced with shared `ErrorNotice message={hostError}`; `.warning` CSS retained (still used by the interruption banner).
- `SettingsPage.tsx` `readableError`: `unsupported` now gated through the same CJK/`localized` check as `invalid_config`/`internal`; raw non-displayable backend messages surface only inside a collapsed 「详细信息」 (`Details`) at both render sites (image `errorBadge` and text-model feedback line). No new locale keys needed — reused existing `当前模型不支持此项。` fallback and shared `Details` 详细信息 summary.

Check after: `NL_REPLAY=strict pnpm check` exit 0 — lint 33 warnings / 2 infos / 0 errors; vitest Test Files 77 passed | 1 skipped (78), Tests 1212 passed | 3 skipped (1215), duration 192.92s. E2E: the exact full-glob command `pnpm test:e2e --grep 'M0 desktop shell|M0 UI shell|M0 settings|M4 usage|M5 locales|M5 share UI'` crashes at spec-load time with `TypeError: Module "…/packages/ui/src/locales/en/agent.json" needs an import attribute of "type: json"` — pre-existing on clean ui-polish/integration (verified with rework changes stashed); cause: e184fa8 (ui-polish/06) added `import { msg } from '../../../i18n'` to `packages/ui/src/pages/player/controls/controller.ts`, so tests/e2e/m3-controls.spec.ts's Node-side import chain reaches the runtime i18n locale JSONs and kills the whole grep-mode run before any test executes; fix belongs to task 06 rework. Scoped equivalent run (only the spec files whose titles the grep matches — m0-shell, m0-settings, m4-usage, m5-locales — so m3-controls.spec.ts is never loaded): `xvfb-run -a env NL_REPLAY=strict pnpm playwright test tests/e2e/m0-shell.spec.ts tests/e2e/m0-settings.spec.ts tests/e2e/m4-usage.spec.ts tests/e2e/m5-locales.spec.ts --grep 'M0 desktop shell|M0 UI shell|M0 settings|M4 usage|M5 locales|M5 share UI'` exit 0 — `11 passed (14.4s)`.
Review: pass (base 7f6938607279e010942e5f0743ef27c0d5a4c62b, reviewer uipo-02-rework.Review02) — no actionable findings; ErrorNotice API correct, `.warning` retention justified, detail confined to collapsed Details, tokens only.

### Residuals

- (a) tests/e2e/m4-gate.spec.ts (not owned by task 02) still asserts removed usage regions `已发生用量` (~lines 811-817 → should now be region `按模型汇总`) and `过期素材` (~865-870, section deleted per maintainer decision) — gate task 08 must update.
- (b) zh-TW/production.json `空闲: 閒置` should be `空閒` (production window's file).
- (c) group labels in the work switcher dropdown use a disabled-item style override in AppShell.module.css because components/Dropdown has no label variant (foundation gap).
- (d) queue drawer rows still link away and close the drawer (U9 nav feedback) — out of distilled scope.
- (e) library group heading collapses only $HOME-prefixed paths via formatPath (paths outside home stay absolute, user-chosen).

Screenshots light/dark in /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task02/.
