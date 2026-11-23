# 02: 完成 Pixi 场面演出与素材窗口

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W1
**Files:** packages/player/src/stage/, tests/e2e/m3-stage.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 stage directions'` → 真实舞台支持演出全集及四种横屏裁切。
**Base commit:** f08f8b74548b807333aaa9db2cefc7fb348421d1

- [x] 覆盖演出幂等、相对动画、预载与引用计数卸载，作品 CSS 不改变默认 UI。

## Progress

- Completion: done.
- Save/history integration: rebased onto `origin/main` at `2fb618d` (PR #55) without conflicts. `mountStage` implements `SnapshotRenderer`; `restoreSnapshot` restores state, replays only state directions, skips relative effects and restarts DOM text at page 0. Lookahead references remain retained during restore.
- `mountMinimalPlayer` returns progress/state/snapshot/thumbnail/restore handles; optional chapter ID and shared `PlaybackProgress` support the host's chapter ordering. Sentence snapshots are recorded on advance and unfinished effects retain restore policies. Save-menu IPC and disk-store ownership remain with the host, not the stage.
- Thumbnails render actual Pixi pixels to centered cover-cropped 480×270 WebP bytes, excluding the text-panel area. Coverage checks format/dimensions, portrait pixels, identical restored-stage thumbnail pixels, replay-state effects, empty snapshots and render/encoder failures.
- Final verification: `NL_REPLAY=strict NL_STAGE_SHOTS=/home/ubuntu/m3-shots xvfb-run -a pnpm test:e2e --grep 'M3 stage directions|M1b minimal player|M3 save'` → 4 passed; `NL_REPLAY=strict pnpm check` → 35 files / 454 tests passed, including `tests/integration/m3-save.test.ts`; isolated stage checks → 3 files / 11 tests passed. The sole lint info remains the existing `useTemplate` diagnostic. The rebased upstream upscale tests require `mesa-vulkan-drivers` (installed in the environment; no repository configuration changes).
- Review follow-up: all Pixi layers are clipped together at the measured DOM text-box boundary, updated on viewport/text-box resize. The composite e2e compares text-panel pixels without particles against three particle-active frames. Strict Electron regression: 3 passed; repository checks: 31 files / 412 tests passed; isolated stage checks: 2 files / 8 tests passed. Regenerated `/home/ubuntu/m3-shots/stage-composite.png` visually confirms no particles in the panel.
- Implemented JSON stage state, Pixi camera/CG/foreground/particles/filters/masks/transitions, snapshot restoration API, relative animations and a reference-counted 20–32 sentence asset window. Text stays in the DOM on `var(--font-body)`; no work stylesheet is injected.
- Registered the image parser with a parser-level id and the current `parser` API. Particle textures use a canvas-backed source compatible with both Canvas and WebGL. Shared Electron protocol configuration is unchanged.
- Check after: `NL_REPLAY=strict NL_STAGE_SHOTS=/home/ubuntu/m3-shots xvfb-run -a pnpm test:e2e --grep 'M3 stage directions|M1b minimal player'` → 3 passed. The M3 test uses software WebGL for real shader-filter pixel assertions on Linux CI and captures renderer errors.
- Repository checks: `NL_REPLAY=strict pnpm check` → typecheck/lint passed, 31 test files / 412 tests passed (one existing informational `useTemplate` diagnostic in `tests/fixtures/text-models/build-synthetic.ts`). Isolated stage tests → 2 files / 8 tests passed.
- Visually compared centered cover-cropping and DOM overlay layering with the running prototype. Evidence: `/home/ubuntu/m3-shots/stage-{16-10,4-3,phone,21-9}.png`, `stage-composite.png` (CG + sakura + sepia), and `prototype-reference.png`. Corrected viewport mask bounds and regular particle banding. These fixtures verify geometry/effects, not representative artwork or pixel-identical UI styling.
- Review: skipped — no independent reviewer was assigned for this scoped task; milestone acceptance remains separate.
