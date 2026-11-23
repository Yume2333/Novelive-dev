# 02: 完成 Pixi 场面演出与素材窗口

**Effort:** m3-playback
**Blocked by:** 01
**Covers:** W1
**Files:** packages/player/src/stage/, tests/e2e/m3-stage.spec.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M3 stage directions'` → 真实舞台支持演出全集及四种横屏裁切。
**Base commit:** f08f8b74548b807333aaa9db2cefc7fb348421d1
**Status:** paused

- [ ] 覆盖演出幂等、相对动画、预载与引用计数卸载，作品 CSS 不改变默认 UI。

## Progress

- Implemented stage state reducer, Pixi renderer, reference-counted 20–32 sentence asset window, desktop export wiring and stage tests; not accepted yet.
- Check after: `NL_REPLAY=strict pnpm check` passed (31 files / 412 tests); isolated stage Vitest checks passed (2 files / 7 tests).
- Check after: `NL_REPLAY=strict xvfb-run -a pnpm test:e2e --grep 'M3 stage directions|M1b minimal player'` failed twice at initial stage rendering (`无法加载舞台素材`). Paused at the two-attempt limit; checkbox remains open.
- Next: inspect custom image loader registration: Pixi Loader hashes parser `name`/`id`, while the current parser only declares `extension.name`; fallback bitmap loading uses fetch, but the desktop custom scheme does not declare `supportFetchAPI`. Add a parser-level id/name and use `parser` instead of deprecated `loadParser`, then rerun the Electron check. This diagnosis is static, not runtime-confirmed.
- Visual/prototype comparison and full animation/restore acceptance remain incomplete; no successful stage screenshots were produced.
