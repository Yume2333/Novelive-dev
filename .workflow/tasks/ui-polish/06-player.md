# 06: Player polish

**Effort:** ui-polish
**Blocked by:** 01
**Covers:** W1, W2, W3, W4
**Files:** packages/ui/src/pages/player/, packages/ui/src/locales/*/player.json, tests/e2e/{m3-controls,m3-stage,m3-text,m1b-player}.spec.ts
**Read first:** .workflow/specs/ui-polish.md, .workflow/research/ui-polish-audit.md §「pages/player/ + panels/agent/」 (Player rows L15–L20, S6–S11, U4–U17), DESIGN.md, packages/ui/src/format/
**Check:** `NL_REPLAY=strict pnpm check` and `xvfb-run -a env NL_REPLAY=strict pnpm test:e2e --grep 'M3 controls|M3 stage|M3 text|M1b player'` pass.

- [ ] **Leaks** L15–L18: history group headers and save excerpts fall back to 「未知章节」, never `chapterId`; the legacy-save panel says 「旧版本的存档（版本 3）」, and rows show time and excerpt, not 「槽位 N」; text speed becomes a unitless 慢 ↔ 快 slider with an instant endpoint, replacing the separate 「瞬间显示」 toggle (mapping stays internal); compile diagnostics become 「这部作品的内容有问题，无法播放」 with details in `Details`. Keep the `data-mainline` test hook.
- [ ] **Style** S6–S11: the bare 「打开本地工程」 button becomes `Button`; every unstyled error `<p>` becomes `ErrorNotice` or the shared inline error style; overlay screens (save grid, history, settings, legacy saves) use `--space-*` and type tokens (the stage skin stays exempt); the legacy panel uses `.hover-row`/`.row-actions` and list-row conventions; chapter labels use `formatChapterLabel`.
- [ ] **UX** U5–U15: hide 「在编辑器中打开这里」 when the work can't be linked; save-slot cards lead with chapter and excerpt, with the slot number as meta; the legacy panel explains why the saves can't load and that deleting them is safe, offers 「全部删除」 with a confirmation message, and appears only on the load screen; background failures (for example progress save) use a dismissible toast or banner instead of the fullscreen red box, which is reserved for load failures; waiting-card phase fractions live with the phase definitions; one locale voice (`无法…，请重试`, consistent 跳過, en "Quick save").
- [ ] Sync all four locales and update the listed e2e specs where intended copy or DOM changed.
