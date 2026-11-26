# 02: Shell, welcome, library, usage, and settings polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/shell/, packages/ui/src/pages/{welcome,library,usage,settings}/, packages/ui/src/locales/*/{shell,welcome,library,usage,settings,main}.json, tests/e2e/{m0-shell,m0-ui-shell,m0-settings,m4-usage,m4-tray,m5-locales,m5-share-ui}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「App Shell & Global Pages」, DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M0 desktop shell|M0 UI shell|M0 settings|M4 usage|M5 locales|M5 share UI'` pass.

- [ ] **Leaks** L1–L12: no volume ids, project ids, work UUIDs, or asset keys anywhere. `AppShell` falls back to `formatWorkTitle`; library group headings and settings paths use `formatPath`; usage money uses `formatCost`; the model id is secondary text, not the bold lead; the model card summary shows only the model name (the format moves into the expanded editor); the 「日志」 button becomes 「查看诊断信息」.
- [ ] **Usage page** (maintainer decision): replace the per-call 「已发生用量」 list with per-day and per-model aggregates; delete the 「过期素材」 section; wrap the 「部分项目无法读取」 warning in `Banner kind="warning"` with humanized entries; localize the date-range inputs to the UI language (use the shared control or set `lang`); trim the info tooltip to billing facts only; give bar-chart bars a real role or make them non-interactive; fix the negative-margin spacing hack against `DESIGN.md` spacing.
- [ ] **Style** S1–S13: every error/load state uses `ErrorNotice`/`LoadingState`; one `EmptyState` convention (no double `Card` wrapper); settings and library cards compose the shared `Card`; one card radius; type tokens replace 13.5px and other off-scale sizes; welcome model setup reuses the settings model field components (including 「兼容哪家」) with its simpler layout; `font` shorthand unified.
- [ ] **UX** U1–U14: one progress line on library cards (published vs read made distinct or merged per the prototype); unplayable imported works explain why they aren't clickable; the 「有 n 部作品无法读取」 notice gives a reason and an action; the work switcher is discoverable and its items are grouped (projects / packages) with consistent labels; the queue drawer shows no duplicate 「制作队列」 heading, keeps the stop confirmation readable, and has row cover thumbnails; About section rhythm and icons are consistent; production role rows drop the repeated meaningless icon; welcome step 2 explains in one line what the models are for; one step indicator component.
- [ ] Sync all four locales and update the listed e2e specs where intended copy or DOM changed; never weaken an assertion.
