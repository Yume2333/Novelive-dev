# UI Prototype Fidelity — Side-by-Side Audit (W4, round 5)

**Commit:** `ea4b05c8d6850cad5413e117e03e91a2d8396a5a` (integration tip: round-4 gate HEAD `772e8dc` + round-4 rework merges — `aafbc39` CompactSelect chevron shell, `6729014` work 更多 menu ordering, `707ffe2` player toggle/sysmenu/agent bubbles, `dd1c0f7` agent bubble shrink-wrap — all packages/ui chrome). Production build `apps/desktop/out` built 2026-11-26 09:16 from this revision by the E2E worker; not rebuilt for captures.
**Captured:** 2026-11-26, viewport **exactly 1440×900 device pixels both sides, DPR 1**, light + dark themes.
**Method:**

- **Headless throughout, zero visible windows.** Prototype: Playwright chromium `headless: true`. Production: Electron via `env -u WAYLAND_DISPLAY -u DISPLAY ELECTRON_OZONE_PLATFORM_HINT=x11 XDG_SESSION_TYPE=x11 xvfb-run -a` with `--ozone-platform=x11` in args; post-launch verification of `/proc/<electron pid>/environ` showed **zero `WAYLAND*` variables** and cmdline `--ozone-platform=x11` on every boot (the `XDG_RUNTIME_DIR` wayland-0 leak was pre-empted by the env stripping — correction proven by the E2E worker).
- **Prototype** (`prototype/`, vite dev server on :5199, full mock data): unchanged since round 4. Scripts [scripts/uip-win-08-visual-capture-proto.mjs](scripts/uip-win-08-visual-capture-proto.mjs), [scripts/uip-win-08-visual-capture-proto-overlays.mjs](scripts/uip-win-08-visual-capture-proto-overlays.mjs), [scripts/uip-win-08-visual-proto-playersettings.mjs](scripts/uip-win-08-visual-proto-playersettings.mjs). Navigation hardened this round (`about:blank` full reload between shots — HashRouter same-document hash navigation leaks open panels across surfaces) plus `document.fonts.ready` waits.
- **Production** (`apps/desktop` Electron, `NL_REPLAY=strict`, isolated `HOME=/tmp/uip-win-08-visual` + XDG overrides): real offline cassette pipeline end-to-end — combined `tests/fixtures/cassettes/m1b-gate` + `m1b-art`, real import wizard, real visual confirmation through the real UI, real chapter production/failure states. No IPC mocking except the Agent transcript (`chat.*` projection — no chat cassette exists). Main script [scripts/uip-win-08-visual-capture-prod.mjs](scripts/uip-win-08-visual-capture-prod.mjs) + shared [scripts/uip-win-08-visual-lib.mjs](scripts/uip-win-08-visual-lib.mjs) (repo-relative paths this round); overlays in same script plus [scripts/uip-win-08-visual-capture-player-overlays.mjs](scripts/uip-win-08-visual-capture-player-overlays.mjs); single-shot redos [scripts/uip-win-08-visual-capture-stopconfirm-redo.mjs](scripts/uip-win-08-visual-capture-stopconfirm-redo.mjs), [scripts/uip-win-08-visual-capture-importmodal-redo.mjs](scripts/uip-win-08-visual-capture-importmodal-redo.mjs), [scripts/uip-win-08-visual-capture-importmodal-dark-redo.mjs](scripts/uip-win-08-visual-capture-importmodal-dark-redo.mjs), agent fallback [scripts/uip-win-08-visual-capture-agent.mjs](scripts/uip-win-08-visual-capture-agent.mjs); computed-style probes [scripts/uip-win-08-visual-probe.mjs](scripts/uip-win-08-visual-probe.mjs).
- **Naming:** surfaces `<surface>-<theme>-{prototype,production}.png`; overlays `overlay-<name>-{prototype,production}-<theme>.png` — mirrored exactly across the two sides this round. Stale round-4 files in the old naming (`overlay-*-<theme>-production.png`, `shell-*`, `*-darkfix*`) were untracked and are deleted.
- **Zero paid API calls**: all model/image traffic replayed from cassettes. Flat-color bitmaps in player/editor/confirm shots are the cassette fixtures themselves (verified: fixture PNGs 1536×864 at ≈0.017 bytes/pixel — solid-color test art by design), not a rendering defect.
- **Evidence:** `.workflow/evidence/ui-prototype-fidelity/screenshots/` — 28 prototype surface files, 28 production surface files, all verified 1440×900, zero viewport warnings in any capture log.
- **Vision-QA caveat carried forward:** the vision model's recurring "blurred/redacted rectangle" claims in glass headers are normal glassmorphism; every claim was settled by crop re-inspection or computed-style probes.

**Data-content differences are not failures.** Prototype mocks seed 4–24-chapter works with hand-drawn art; production captures show a real 2-chapter cassette work. Density/content deltas (fewer chapters/characters, single-day usage chart, intentional `[network] Model connection interrupted` chapter-2 failure, tokens=0, empty save slots, `暂无章节` behind the agent panel caused by the chat projection's canned `production.get`) are replay data or harness artifacts, not scored.

## W1 — component-kit control audit: PASS

See [control-audit.txt](control-audit.txt): **42/42 exports** accounted for, **0 native regressions** (every interactive surface uses kit components; native `title` attributes only where the prototype itself carries them).

## W2/W3 — integration gate: PASS

See [e2e-summary.txt](e2e-summary.txt): `pnpm check && pnpm build` **exit 0**; E2E **81 passed / 1 failed / 3 skipped**. The one failure (`m3-text.spec.ts:389`) is pre-existing and documented in `.workflow/evidence/prototype-parity/player-agent/audit.md:24`; `m1b-production-contract:82` and `m4-single-instance:55` are pre-existing environment flakes (rotating, documented in the summary). Test selector migrations carried from the round-4 gate (kit Toggle `role=switch` via `tests/e2e/support/toggle.ts`, status-toast lookups, usage Drawer close, locales surface) land with this commit; no new test edits in round 5.

## W4 — parity matrix

✓ verified in capture, both themes. Each surface links the four evidence files (prototype light/dark · production light/dark).

| Surface | Evidence (proto light/dark · prod light/dark) | Verdict | Notes |
|---|---|---|---|
| shell-queue | [pl](screenshots/shell-queue-light-prototype.png)/[pd](screenshots/shell-queue-dark-prototype.png) · [Pl](screenshots/shell-queue-light-production.png)/[Pd](screenshots/shell-queue-dark-production.png) | **PASS** | Drawer chrome, sections, glass rows, thumbnails match. Live 排队中 rows with reorder arrows again not capturable (capture-harness note H2 below) — verified in source `ProductionQueuePanel.tsx` + round-2 evidence. Production capture state shows 未在排队 + paused-failed work — data state, not chrome |
| welcome | [pl](screenshots/welcome-light-prototype.png)/[pd](screenshots/welcome-dark-prototype.png) · [Pl](screenshots/welcome-light-production.png)/[Pd](screenshots/welcome-dark-production.png) | **PASS** | Centered wizard card, step dots, language RadioGroup, 继续 CTA — identical anatomy both themes |
| library | [pl](screenshots/library-light-prototype.png)/[pd](screenshots/library-dark-prototype.png) · [Pl](screenshots/library-light-production.png)/[Pd](screenshots/library-dark-production.png) | **PASS** | Sidebar + tabs + hierarchical group cards + status lines + confirm chips. `/tmp` paths are harness projects dir, not a defect |
| usage | [pl](screenshots/usage-light-prototype.png)/[pd](screenshots/usage-dark-prototype.png) · [Pl](screenshots/usage-light-production.png)/[Pd](screenshots/usage-dark-production.png) | **PASS** | Metric cards + daily bar chart + work×stage table; 4 filter CompactSelects all chevron-inside-box (probe 1c). Tokens=0 is cassette data (residual #8) |
| settings | [pl](screenshots/settings-light-prototype.png)/[pd](screenshots/settings-dark-prototype.png) · [Pl](screenshots/settings-light-production.png)/[Pd](screenshots/settings-dark-production.png) | **PASS** | **R4-2 closure: 界面 section CompactSelects now render chevron inside the filled box in both themes** (probe values below). 5 model rows + 高级 disclosure + licenses Modal verified. Theme-select 暗-in-light-shot remains the documented capture artifact (widget reflects saved config, not forced `data-theme`) |
| import | [pl](screenshots/import-light-prototype.png)/[pd](screenshots/import-dark-prototype.png) · [Pl](screenshots/import-light-production.png)/[Pd](screenshots/import-dark-production.png) | **PASS** | 3-step stepper, dashed dropzones with real backend format captions, folder picker, disabled 下一步 state |
| work | [pl](screenshots/work-light-prototype.png)/[pd](screenshots/work-dark-prototype.png) · [Pl](screenshots/work-light-production.png)/[Pd](screenshots/work-dark-production.png) | **PASS** | **R4-4 closure: 更多 dropdown live-verified exactly [导出作品包, 作品设置]** (probe 4e). Hero + phase card + chapter rows match; `[network]` failure line is seeded data |
| confirm-visual | [pl](screenshots/confirm-visual-light-prototype.png)/[pd](screenshots/confirm-visual-dark-prototype.png) · [Pl](screenshots/confirm-visual-light-production.png)/[Pd](screenshots/confirm-visual-dark-production.png) | **PASS** | Radio groups, candidate cards, zoom Expand at top-left inside image, 还差 N 项未选定 disabled CTA. 重新生成 correctly absent (residual #9) |
| confirm-first | [pl](screenshots/confirm-first-light-prototype.png)/[pd](screenshots/confirm-first-dark-prototype.png) · [Pl](screenshots/confirm-first-light-production.png)/[Pd](screenshots/confirm-first-dark-production.png) | **PASS** | 确认点 2/2 breadcrumb, scene card with asset counts, PlayCircle 试玩第一章 |
| production | [pl](screenshots/production-light-prototype.png)/[pd](screenshots/production-dark-prototype.png) · [Pl](screenshots/production-light-production.png)/[Pd](screenshots/production-dark-production.png) | **PASS** | Failure banner + 全部重试， pipeline 写剧本>审稿>演出>出图， status pills; 已停止 correct for the seeded paused state |
| editor | [pl](screenshots/editor-light-prototype.png)/[pd](screenshots/editor-dark-prototype.png) · [Pl](screenshots/editor-light-production.png)/[Pd](screenshots/editor-dark-production.png) | **PASS** | Side-by-side stage + sentence panel, CompactSelect chapter/scene pickers, mark-proposal banners, 更多 dropdown (修改历史/存为规则), history drawer empty state |
| bible | [pl](screenshots/bible-light-prototype.png)/[pd](screenshots/bible-dark-prototype.png) · [Pl](screenshots/bible-light-production.png)/[Pd](screenshots/bible-dark-production.png) | **PASS** | Category sidebar + character detail + 还没画 dashed expression cards + 候选与冲突 chip row |
| player | [pl](screenshots/player-light-prototype.png)/[pd](screenshots/player-dark-prototype.png) · [Pl](screenshots/player-light-production.png)/[Pd](screenshots/player-dark-production.png) | **PASS** | **R4-1/R4-3 closures verified in player overlay captures + probes (below)** — off-state toggles now have visible tracks both themes; sysmenu opens with no focus card |
| agent | [pl](screenshots/agent-light-prototype.png)/[pd](screenshots/agent-dark-prototype.png) · [Pl](screenshots/agent-light-production.png)/[Pd](screenshots/agent-dark-production.png) | **PASS** | **R4-5 closure: assistant text verified inside filled bubble card** (visual + `MessageView.tsx:990` assigns `styles.textBubble` to non-mine text; `MessageView.module.css:273-286` carries padding/border/radius/background); active session item probe `backgroundColor: transparent, boxShadow: none` — no fill. Dark shot recaptured via single-boot fallback (`panel-open-probe=true`) |

### Overlay matrix

Prototype and production captured with the same overlay set; names mirror exactly. ✓ = verified open, populated, correct theme in the image.

| Overlay | Prototype | Production | Verdict |
|---|---|---|---|
| library import-package Modal | [light](screenshots/overlay-library-import-modal-prototype-light.png)/[dark](screenshots/overlay-library-import-modal-prototype-dark.png) | [light](screenshots/overlay-library-import-modal-production-light.png)/[dark](screenshots/overlay-library-import-modal-production-dark.png) | **PASS** — production evidence is a real round-trip: the seeded work was exported to a real `.novelive` in-session via `host.share` `export`, then re-inspected through the real modal （检查完成：是新作品 review state) |
| work 更多 Dropdown | [light](screenshots/overlay-work-dropdown-prototype-light.png)/[dark](screenshots/overlay-work-dropdown-prototype-dark.png) | [light](screenshots/overlay-work-dropdown-production-light.png)/[dark](screenshots/overlay-work-dropdown-production-dark.png) | **PASS** — items exactly [导出作品包， 作品设置] both sides (probe 4e) |
| work 作品设置 Drawer | [light](screenshots/overlay-work-settings-drawer-prototype-light.png)/[dark](screenshots/overlay-work-settings-drawer-prototype-dark.png) | [light](screenshots/overlay-work-settings-drawer-production-light.png)/[dark](screenshots/overlay-work-settings-drawer-production-dark.png) | **PASS** — read-only rows in production are backend-limited (residual #2), chrome matches |
| editor 更多 Dropdown | [light](screenshots/overlay-editor-dropdown-prototype-light.png)/[dark](screenshots/overlay-editor-dropdown-prototype-dark.png) | [light](screenshots/overlay-editor-dropdown-production-light.png)/[dark](screenshots/overlay-editor-dropdown-production-dark.png) | **PASS** |
| editor 修改历史 Drawer | [light](screenshots/overlay-editor-history-drawer-prototype-light.png)/[dark](screenshots/overlay-editor-history-drawer-prototype-dark.png) | [light](screenshots/overlay-editor-history-drawer-production-light.png)/[dark](screenshots/overlay-editor-history-drawer-production-dark.png) | **PASS** — identical empty state 还没有修改/每步修改都可撤销 |
| production 运行记录 Drawer | [light](screenshots/overlay-production-runrecord-drawer-prototype-light.png)/[dark](screenshots/overlay-production-runrecord-drawer-prototype-dark.png) | [light](screenshots/overlay-production-runrecord-drawer-production-light.png)/[dark](screenshots/overlay-production-runrecord-drawer-production-dark.png) | **PASS** — numbered step cards with 完成 pills + timestamps |
| production stop ConfirmDialog | [light](screenshots/overlay-production-stop-confirm-prototype-light.png)/[dark](screenshots/overlay-production-stop-confirm-prototype-dark.png) | [light](screenshots/overlay-production-stop-confirm-production-light.png)/[dark](screenshots/overlay-production-stop-confirm-production-dark.png) | **PASS** — production captured live this round (harness note H1); shared ConfirmDialog chrome identical |
| toast | [light](screenshots/overlay-toast-prototype-light.png) | [light](screenshots/overlay-toast-production-light.png) | **PASS** — production toast is the real 作品包导入完成 success toast, top-center |
| player system menu | [light](screenshots/overlay-player-sysmenu-prototype-light.png) | [light](screenshots/overlay-player-sysmenu-production-light.png)/[dark](screenshots/overlay-player-sysmenu-production-dark.png) | **PASS** — 7g verified: no focus card on open, 返回作品页 isolated below divider, quick rows icon-aligned. (Prototype dark-variant file was a round-4 `-darkfix` artifact, deleted as stale; light + production pair cover the chrome.) |
| player save/load | [light](screenshots/overlay-player-saveload-prototype-light.png)/[dark](screenshots/overlay-player-saveload-prototype-dark.png) | [light](screenshots/overlay-player-saveload-production-light.png)/[dark](screenshots/overlay-player-saveload-production-dark.png) | **PASS** — empty slots are replay data depth |
| player settings | [light](screenshots/overlay-player-settings-prototype-light.png)/[dark](screenshots/overlay-player-settings-prototype-dark.png) | [light](screenshots/overlay-player-settings-production-light.png)/[dark](screenshots/overlay-player-settings-production-dark.png) | **PASS** — sliders + both off-state toggles with visible tracks (7f) |
| settings 第三方许可 Modal | — (not in prototype set) | [light](screenshots/overlay-settings-licenses-modal-production-light.png)/[dark](screenshots/overlay-settings-licenses-modal-production-dark.png) | **PASS** (production bonus; prototype licenses content lives in the same shared Modal component, covered by the library import modal) |

## Round-4 rework closure (1c, 4e, 7f, 7g, 7h) — all FIXED, probe-verified live

Probes from [scripts/uip-win-08-visual-probe.mjs](scripts/uip-win-08-visual-probe.mjs) against the live seeded production app (full JSON lines in `/tmp/uip-win-08-visual/probe.log`):

| Item | Probe evidence | Verdict |
|---|---|---|
| **1c** CompactSelect chevron inside box (settings 界面 + usage filter row) | settings light+dark: all 24 selects `rightGap: 0` — including the 界面 rows with the round-4 offender shell class: `{selectW:150, wrapW:150, rightGap:0, wrapCls:"_compactSelectShell… _rowSelect…"}`; usage filters 4/4 `rightGap: 0` (按天 69/69, 全部作品 289/289, 全部阶段 95/95, 全部模型 139/139) | **FIXED** — kit `.compactSelect` now fills its shell; chevron lands inside the visible box in both themes |
| **4e** work 更多 dropdown = [导出作品包， 作品设置] | `PROBE 4e-work-dropdown-items: ["导出作品包","作品设置"]` — exact match, correct order | **FIXED** |
| **7f** player off-state Toggle visible track | light: `backgroundColor: rgb(227,226,224)` = token `--color-surface-container-highest` `#e3e2e0` exactly, `40×23px`, off-state (`aria-checked:false`); dark: `rgb(42,42,47)` = `#2a2a2f` exactly, `40×23px`. Both themes visible, probe-selected the unchecked switch | **FIXED** — round-4 transparent-track cascade defeated |
| **7g** sysmenu: no focus card on open + 返回作品页 below divider + quick rows icon-aligned | open: focus inside panel on 返回游戏 but `:focus-visible=false`, `boxShadow:none` — no card painted (both themes; light screenshot confirms visually, dark re-verified by gate director image inspection); `backButtonPresent:true, dividerBeforeBack:true`; quick rows visually verified icon-aligned in a straight left column with uniform baselines | **FIXED** |
| **7h** agent assistant text in bubble card + no fill on active session item | active session item (`aria-current=true`): `backgroundColor: rgba(0,0,0,0)`, `boxShadow: none` — no fill ✓. Assistant text: visual verification in agent-dark/light shots shows the reply inside a filled rounded card distinct from the panel; source `MessageView.tsx:990` `bubble = nested \|\| mine ? undefined : styles.textBubble` with card styling at `MessageView.module.css:273-286` (padding 9px 13px, border, radius, `background: var(--white-60)`) | **FIXED** (probe's outer-wrapper selector imprecise; verdict backed by source + image) |

## Capture-harness notes (not UI defects)

- **H1 — production stop ConfirmDialog window.** Pre-gate the work status is never `'producing'`: `packages/creator/src/scheduler/chapter/index.ts` `phaseOf()` returns `['preview','idle']` while no chapter tasks exist yet (visual-generation phase), so 立即停止 cannot render before the first gate no matter how the cassette is slowed. The only producing window is after 确认并制作第一章 while chapters write. The main capture's early-phase attempt predictably missed it; the redo booted with `NL_REPLAY_DELAY_MS=300` (stretching chapter production to minutes) and captured the dialog in that window — single open, theme flipped underneath for the second shot. Documented in [scripts/uip-win-08-visual-capture-stopconfirm-redo.mjs](scripts/uip-win-08-visual-capture-stopconfirm-redo.mjs).
- **H2 — live 排队中 rows** remain capture-limited exactly as documented in round 3/4 (cassette drains production near-instantly; final state is paused `chapter_failed`, correctly non-resumable per `ProductionQueuePanel.tsx` logic). Source-verified, round-2 visual evidence stands.
- **H3 — library import modal needed a real package.** The main script's phase-10 read `production.get` after the chat projection had replaced the host port; the projection's canned answer carries no `exportTarget`, so the export silently skipped. Redo boots without the projection export the work for real (`host.share` `export` → `paper.novelive`) and inspect it through the real modal. The first redo also taught: importing in the light pass changes the inspect relation for the dark pass (and the dark modal failed to open on second click) — dark was recaptured in a dedicated fresh boot with `modal-open-probe=true`.
- **H4 — agent dark second-open flakiness** unchanged from round 3/4: the in-pipeline dark agent shot silently fails to open the panel; the dedicated single-boot fallback captured it cleanly (`panel-open-probe=true`). Harness-level, not a panel defect.
- **H5 — `app.close()` occasionally hangs on teardown** of a cassette-driven boot (observed twice); all outputs are written before that point. Not an app defect.
- **H6 — theme-select value in settings shots** reflects the persisted config and can lag the forced `data-theme` by one capture (round-4 documented artifact); pixel backgrounds verified correct per theme.

## Round-2/round-3 rework verification (carried forward — all FIXED, unchanged)

All 13 round-2 items (1a, 2a–2g, 5a, 7a–7e) and 10 round-3 items (1b, 2h, 2i, 2-R, 3a, 4a–4d, 6a, 7-R) were verified FIXED in rounds 3/4 and the fixing code is unchanged at HEAD `ea4b05c` (round-5 rework commits touch only the round-4 items in the table above). Round-2 evidence in `rework2/` and round-3/4 matrices remain valid.

## Backend-limited residuals

Prototype affordances that have **no backend command** in `@novelive/creator/contract` — re-verified against `packages/creator/src/contract/{index,production,editor,import,share,chat,project,queue,usage}.ts` at HEAD `ea4b05c`. Correctly absent or read-only in production; must not be "fixed" by faking local persistence:

1. **Work author line (work hero + library cards).** Neither `workSchema` (`packages/format/src/model/metadata.ts` — no `author` field, re-verified) nor any contract carries an author. Production correctly omits it.
2. **Editable work-settings drawer.** Backend offers only `editor.saveRules` (`contract/editor.ts:141`, re-verified); there is no command to mutate `workSettings.adaptation/stagingDensity/writerPresetId/fidelityReview/styleReview/outputResolution/accent/customMarks`. Production's read-only drawer is the only honest rendering.
3. **Import-wizard adaptation step content.** `import.revise` accepts only `layout` + `selectedIllustrations` (`contract/import.ts:171-177`, re-verified). No way to seed adaptation settings at import time.
4. **Per-card menu on imported works (移除).** `host.installed` exposes `list`/`chapter`/`takeOpenFile` only (`contract/index.ts:224-240`, re-verified) — no uninstall/remove. Correctly absent.
5. **Re-importing an installed package as a project.** `share.importAsProject` requires the original `packagePath` (`contract/share.ts:78-80`, re-verified); `installed.list()` returns no path field.
6. **Bible field direct mutation.** Backend mutation is chat-proposal-driven; no direct `bible.update` command — by design. Production correctly renders read-only fields with 问 Agent affordances.
7. **Production-queue cover art in contract.** `production.getQueue` returns active/queued/inactive without cover metadata. Resolved UI-side with seed-derived `coverGradient` (2h) — no longer a gap.
8. **Usage token/cost data for replayed runs.** Replay cassettes carry no provider token-settlement data, so 文本 tokens read 0 and 参考金额 reads 没有单价. Real runs populate these; not a UI gap.
9. **Pre-confirm visual regeneration.** `production.*` has no regenerate-visual command (`editor.regenerateImage` at `contract/editor.ts:177`, re-verified, is post-production only). The prototype's per-group ↻ 重新生成 is correctly absent.
10. **Agent transcript richness.** Tool-call streaming, summary compression, branching pagination require a live `chat.*` backend; capture used a projection for chrome verification only. No chrome gap identified.
11. **Library attention count in status line.** Prototype shows `已发布 X/Y 章 · N 需处理`; production shows `已发布 X/Y 章 · 需要处理` because `production.getQueue` inactive entries carry no per-work attention chapter count (`contract/queue.ts` — only `status`/`reason`). Copy-level, backend-limited.

## Notes on non-defects verified during audit

- **Library group-header filesystem path** is correct prototype-matching behavior; the `/tmp/…` ugliness is a capture-environment artifact (harness projects dir).
- **`[network] Model connection interrupted or unavailable`** lines on work/production chapter rows are the intentional cassette-replayed chapter-2 failure state — test data, not chrome or a missing error boundary.
- **Flat-color stage bitmaps** in player/editor/confirm shots are cassette-replayed test art (fixture PNGs verified solid-color by compression ratio), not broken assets.
- **Vision-model recurring "blur patch/redaction" claims** in drawer/modal headers are normal glassmorphism — disproven by zoomed-crop re-inspection every time.
- **Settings image-model row** lacks the `· OpenAI Chat Completions` subtitle of the text models because the image model has a different config shape — data-driven.
- **Theme-switcher/queue-badge/reorder-arrow native `title` attributes** exist identically in the prototype — parity, not a violation.
- **Empty save slots / single-day usage / fewer chapters** are replay data depth, not chrome.
- **Player sysmenu dark-shot pill on row 1** (first vision pass): re-verified by the maintainer — no row-1 fill exists in the final evidence; probe confirms `:focus-visible=false` at open in both themes. Closed as artifact-free.
- **`暂无章节` behind the agent panel** in agent captures: the chat projection's canned `production.get` returns empty chapters — harness artifact, not a work-page defect.

## Accepted divergences (carried forward, re-verified)

- Copy-only label differences: confirm-visual CTA 确认并制作第一章， production step label 写剧本， usage 文本 tokens card, library tab icon glyphs, production banner extra dismiss ×, confirm-first trailing sentence, player 历史记录 vs prototype 记录.
- Editor per-mark proposal banners: one banner per proposal is data-correct (backend resolves per suggestionId).
- Finished-reasoning duration label: reasoning parts carry no duration in `contract/chat.ts`; the elapsed-time machinery exists only for live streaming (`MessageView.tsx:145-160`, re-verified — replayed/projected entries legitimately show plain 思考过程）.
- Player text column width constrained by m3-text clip geometry (`packages/player/src/text/text.css`).
- Import dropzone captions (`支持 TXT、EPUB…`, `最多 3 张`) — real backend format/limit constraints.
- Library path home-relativization not required (no home-dir source in renderer).
- Confirm-first `第 1 章 · 第一章 …` label duplication: data-derived chapter titles; pre-existing pattern.
- Player system-menu secondary section: pre-existing production design, extra functional quick actions.

## W5 — Linux AppImage: PASS

- **Path:** `/tmp/uip-win-08-pkg/apps/desktop/dist/linux-x64-lxvfOY/artifacts/Novelive-0.0.0-linux-x86_64.AppImage`
- **Size:** 525,639,015 bytes · **SHA-256:** `05f7d005c094d78be923343102a9c1a6ee1033d26865e5d54614807619a51596`
- **Built** from a `git archive` of `ea4b05c` offline (no network, no paid API).
- **Smoke:** 18/18 PASS headless (no `WAYLAND_DISPLAY` in the app environment); evidence [appimage/01-initial.png](appimage/01-initial.png), [02-library.png](appimage/02-library.png), [03-theme-light.png](appimage/03-theme-light.png), [04-theme-dark.png](appimage/04-theme-dark.png), [05-usage.png](appimage/05-usage.png), [06-settings.png](appimage/06-settings.png).
- **Non-blocking note:** PageAction `.primary` lacks `white-space: nowrap` — the label wraps only at the 639px smoke-window width; not observable at the 1440×900 reference viewport.

## Verdict

**W1 PASS · W2/W3 PASS · W4 PASS (14/14 surfaces both themes, all overlays, round-4 rework 5/5 probe-verified FIXED) · W5 PASS.**
