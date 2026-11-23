# 03: 实现 CJK 文本和句内分页

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W1
**Files:** packages/player/src/text/, tests/e2e/m3-text.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 text typography'` → 真实 DOM 显示禁则、ruby、停顿、分速、标签和三行分页。

- [x] 双层布局稳定换行，提升显示层不重排；无句长硬限制及自动播放/跳过兼容。

## Progress

- Boundary amendment: owner approved localized integration in `packages/player/src/minimal/index.ts` and `packages/player/src/minimal/playback.ts` (mount/dispose, click routing, timed completion hook); all rendering logic remains in `src/text/`.
- Base commit: f08f8b7
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 text typography'` → `2 passed (14.8s)`. Real Electron DOM covers stable wrapping, kinsoku, ruby visible from its first glyph, marks, pause/speed timing, page-scoped clicks, resize anchoring, natural `cont` completion and click-completed `cont` waiting for another click (including after narrowing splits its page). Receipts committed under `.workflow/evidence/m3-playback/03-text-rendering/`: `check.txt`, `regressions.txt`, and visually inspected lossless `{first,second}-page.webp`.
- Verification: `pnpm typecheck` and `pnpm lint` exit 0 (lint reports one existing informational `useTemplate` suggestion in `tests/fixtures/text-models/build-synthetic.ts`); relevant unit suites `m1b-player` and `m3-contract`: 2 files / 10 tests passed. Timing unit cases run within the scoped Playwright spec: empty, instant, nested speed, accumulated and trailing pauses. No model calls or cassettes needed.
- Defaults: 30 ms/grapheme, 30px / 78% box, maximum three lines per page; prefer a two-line page when its ending is punctuation. Use bundled `--font-body`, Chromium line breaking, grapheme spans and full-sentence cloned layout; page clipping and translation preserve markup without reflow. Click completes only the current page. Auto dwell is `(1200 + 80 × page characters) / multiplier`, omitted on the final page of `cont`; `TextOptions.skip` completes the whole sentence immediately for the controls task to consume.
- PR #53 review follow-up: addressed the six findings relayed by the lead. Additional approved scope: `tests/e2e/m1b-player.spec.ts`, `tests/e2e/m2-editor.spec.ts` (display-layer assertions; wait for reveal before advancing), and committed task receipts. All 11 cases in those two regression specs passed; their initial doubled-text assertion failures are resolved.
- Second review round: a click-completed final `cont` page now waits for a second click (player click-to-complete semantics), while natural completion still continues immediately. The automatic-page observer attaches to the stable overlay before the line mounts and checks current state immediately, avoiding both late subscription and detached-host races.
- Third review round (lead-directed): remeasurement preserves the click-completed hold; newly split pages advance manually and completion releases only after the final page. Covered by narrowing the held `cont` text to two glyphs per line in the real DOM.
- Review: skipped — this Sidekick session has no fresh reviewer/subagent tool; independent review remains for the lead. No task archive, spec changes or landing performed because the requested deliverable is a pushed feature branch and the file boundary excludes those operations.
