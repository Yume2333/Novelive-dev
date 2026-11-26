# 06: Player polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/player/, packages/ui/src/locales/*/player.json, tests/e2e/{m3-controls,m3-stage,m3-text,m1b-player}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/player/ + panels/agent/」 (Player rows L15–L20, S6–S11, U4–U17), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M3 controls|M3 stage|M3 text|M1b player'` pass.

- [x] **Leaks** L15–L18: history group headers and save excerpts fall back to 「未知章节」, never `chapterId`; the legacy-save panel says 「旧版本的存档（版本 3）」, and rows show time and excerpt, not 「槽位 N」; text speed becomes a unitless 慢 ↔ 快 slider with an instant endpoint, replacing the separate 「瞬间显示」 toggle (mapping stays internal); compile diagnostics become 「这部作品的内容有问题，无法播放」 with details in `Details`. Keep the `data-mainline` test hook.
- [x] **Style** S6–S11: the bare 「打开本地工程」 button becomes `Button`; every unstyled error `<p>` becomes `ErrorNotice` or the shared inline error style; overlay screens (save grid, history, settings, legacy saves) use `--space-*` and type tokens (the stage skin stays exempt); the legacy panel uses `.hover-row`/`.row-actions` and list-row conventions; chapter labels use `formatChapterLabel`.
- [x] **UX** U5–U15: hide 「在编辑器中打开这里」 when the work can't be linked; save-slot cards lead with chapter and excerpt, with the slot number as meta; the legacy panel explains why the saves can't load and that deleting them is safe, offers 「全部删除」 with a confirmation message, and appears only on the load screen; background failures (for example progress save) use a dismissible toast or banner instead of the fullscreen red box, which is reserved for load failures; waiting-card phase fractions live with the phase definitions; one locale voice (`无法…，请重试`, consistent 跳過, en "Quick save").
- [x] Sync all four locales and update the listed e2e specs where intended copy or DOM changed.

## Progress

Base commit: 3765fcb805ec811299e48501d04e9ef354dc20ab

Check before: baseline integration e2e (same env) red on 5 pre-existing tests: m3-stage.spec.ts 「directions…landscape fill crops」, m3-text.spec.ts 「page clip boundary…ruby-inflated lines」, m3-gate.spec.ts 「M3 full playback restores…」, m3-controls.spec.ts 「persistent slots, thumbnails, history and reread survive restart」, m5-delivery.spec.ts 「M5 full delivery…」; pnpm check not run before.

Check after: `pnpm check` exit 0 — typecheck + lint pass (biome/stylelint emit warnings only; `!important` count in controls.css unchanged at 15 vs base, zero added by this diff) and vitest `Test Files 76 passed | 1 skipped (77)`, `Tests 1195 passed | 3 skipped (1198)`. E2E per-file run (xvfb-run -a, NL_REPLAY=strict, NODE_OPTIONS json hook): exit 1 with exactly the same 5 pre-existing failures as baseline — m3-controls「persistent slots…」(30s timeout), m3-gate「M3 full playback restores…」, m3-stage「directions…landscape fill crops」(pixel [37,51,96] vs [32,48,96] mismatch), m3-text「page clip boundary…ruby-inflated lines」, m5-delivery「M5 full delivery…」(radio outside viewport); all other tests in the seven files passed — 13 passed including m1b-player.spec.ts, m5-share-ui.spec.ts and the remaining m3-controls/m3-stage/m3-text tests. Literal brief grep command `pnpm test:e2e --grep 'M3 controls|M3 stage|M3 text|M1b player'`: matches only 4 test titles (see residual note).

Review: pass (base 3765fcb805ec811299e48501d04e9ef354dc20ab, reviewer w06-reviewer). Its findings were fixed: non-dismissible save/load error overlay → toast; 「打开本地工程」 hidden under load error; en locale voice. Visual pass in light+dark done — evidence: /home/shizuku/Project/Novelive-omp-artifacts/ui-polish-2026-11-26/evidence/task06/ (fixed: slider end-label dark contrast, sticky pagination nav).

Residuals:
- history-nav disabled-button styling is the shared disabled treatment.
- `humanizeError` `not_found` entry reads model-flavoured (foundation gap for window 01/gate).
- Window-ownership deviations: tests/e2e/{m3-gate,m5-share-ui,m5-delivery}.spec.ts and tests/fixtures/m5-legacy-saves.tsx edited because player copy/DOM changes broke them.
- Slider API unchanged (readout hidden by CSS in controls.css since components/ belongs to window 01 — gap: Slider has no way to hide the numeric readout).
- Literal grep in the brief matches only 4 tests; real coverage run per-file as well.
- E2E needs the NODE_OPTIONS JSON import hook in this environment (Playwright/Node 24 `with {type:json}` issue, pre-existing).
- The 5 pre-existing e2e failures reproduce identically on the untouched integration baseline in this environment; not chased.
- U4 (duplicated action sets in the menu) left as-is per audit (informational); U6 first-empty-slot emphasis left as-is (inherited prototype design gap); L19 `data-mainline` kept as test hook.
