# ui-polish before/after audit (gate 08)

**Date:** 2026-11-26
**Audited revision:** `ui-polish/integration` (tasks 01–07 merged)
**Method:** real offline cassette pipeline (m1b-gate + m1b-art cassettes, `NL_REPLAY=strict`, isolated HOME, Electron under xvfb, 1280×800). Failure states exercised end-to-end: a failed chapter (`gate-writer-rejected` → humanized error), a stale asset (`room/day` marked stale in the project DB), two unreadable project bindings (`broken-alpha`/`broken-beta` pointing at missing directories), agent tool cards + a rewrite-proposal card (chat projection fixture). Every image was inspected visually; contrast numbers below are objective pixel measurements where cited.
**Before images:** `.workflow/evidence/ui-prototype-fidelity/` — `screenshots/<surface>-<theme>-production.png` for all surfaces; `rework2/` supersedes for editor, player, shell-queue (later pre-polish state).
**After images:** `after/<surface>-<light|dark>.png` (14 surfaces × 2 themes) plus supplementary evidence: `usage-scrolled-*` (aggregate tables), `settings-scrolled-*` (project-dir/about rows), `production-runrecord-*` (records drawer), `production-stale-*` (stale-asset drawer), `agent-proposal-*` (rewrite hunk card), `player-sysmenu/settings/saveload/history-*` (player overlays). All PNG ≤ 184KB.

---

## Per-surface matrix

Legend: **fixed** — verified in after-evidence or source; **residual** — accepted with reason; **FAILED** — still broken, needs rework.

### shell/queue — before: `../ui-prototype-fidelity/rework2/shell-queue-light-production.png` / `../ui-prototype-fidelity/rework2/shell-queue-dark-production.png` · after: [light](after/shell-light.png) [dark](after/shell-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| L4 (high) sidebar work title falls back to raw UUID | fixed | `AppShell.tsx` uses `formatWorkTitle` humanized fallback; no UUID in any capture |
| style2/F1 (high) duplicated `制作队列` heading in drawer | fixed | drawer shows single `制作队列` header + close button (shell-light/dark) |
| F2 (high) queue rows lack cover thumbnails | fixed | rows show GradientCover thumbnail + title + status text (shell-light/dark) |
| S4/S5 (med) PageAction/Button duplication, `action` alias | fixed | `PageAction` now delegates to `ButtonLink variant="primary"`; alias removed (source) |
| U9 (med) drawer rows link away and close silently | residual | documented in done-02 (d): nav feedback out of distilled scope; rows still navigate and close the drawer |
| S9 (low) two UIs for theme setting | residual | accepted duplication per research note itself ("acceptable duplication") |

### welcome — before: `../ui-prototype-fidelity/screenshots/welcome-light-production.png` / `-dark-` · after: [light](after/welcome-light.png) [dark](after/welcome-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| S12 (low) welcome re-implements model form | fixed | welcome reuses `ModelFields` (done-01/02 residuals closed in 02) |
| U7 (med) custom dots vs shared Stepper; no model explanation | residual | stepper visual retained as intentional onboarding design; models step is step 3 `模型配置` — visible in welcome-light/dark; no leak or style violation. Copy-level onboarding simplification not in distilled scope |

### library — before: `../ui-prototype-fidelity/screenshots/library-light-production.png` / `-dark-` · after: [light](after/library-light.png) [dark](after/library-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| L6 (med) series group heading raw absolute path | residual | `formatPath` collapses `$HOME`→`~` only; paths outside home render absolute (done-02 residual e, maintainer-sanctioned: user-chosen path stays visible). Capture evidence shows `/tmp/uipo08-after-capture-…` because the capture sandbox necessarily uses /tmp project roots — real default installs live under home and collapse. Reasoning accepted, but note the research recommended drop-or-tooltip as the cleaner fix |
| U4 (med) uppercase series title + lowercase path collision | fixed | group heading now `series · path` in quiet small text with proper `·` separator; label-caps treatment consistent |
| U6 (med) unreadable alert dead-end | fixed | banner now `有 2 部作品无法读取` + `重新读取` action + `详细信息` disclosure explaining cause and remedy (library-light/dark) |
| S1 (high) bare `<p role="alert">`/`<p role="status">` | fixed | `ErrorNotice`/`LoadingState`/`Banner` throughout (source + captures) |
| S3 (med) two empty-state conventions | fixed | `<EmptyState card>` canonical (source) |
| U10/U11 (low) dual progress bars; dead imported cards | not re-audited | low severity; no regression observed |

### usage — before: `../ui-prototype-fidelity/screenshots/usage-light-production.png` / `-dark-` · after: [light](after/usage-light.png) [dark](after/usage-dark.png) [tables-light](after/usage-scrolled-light.png) [tables-dark](after/usage-scrolled-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| L1 (high) raw `joined-<uuid>` volumeId in rows | fixed | per-call dump replaced by aggregates; no volume ids anywhere (usage-scrolled-light/dark) |
| L2 (high) unreadable projects show raw UUID | fixed | banner reads `部分作品无法读取，未计入统计` + `2 部作品无法读取 · 项目已移动或删除`; raw ids only inside collapsed `详细信息` (usage-light, seeded broken-alpha/beta bindings) |
| L3 (high) stale-asset section with raw assetKey+workId | fixed | section removed per maintainer decision; `过期素材` absent (usage-light) |
| L5 (high) titleOf falls back to raw workId | fixed | per-work table shows `纸船与灯火`; fallback is `已删除的作品` via `formatWorkTitle` (source) |
| L9 (med) 4-digit dollar precision | fixed | `formatCost` shared helper; costs render `没有单价` in offline evidence (no `$0.0423` anywhere) |
| S2 (high) unreadable section unstyled | fixed | `Banner kind="warning"` + grouped humanized lines (usage-light) |
| U1 (high) per-call dump | fixed | aggregated: summary cards + `各天调用量` chart + `按日汇总`/`按模型汇总`/`按作品 × 阶段` tables (usage-scrolled-light/dark) |
| U2 (high) native mm/dd/yyyy date inputs | fixed | inputs carry `lang` + custom overlay rendering locale format `2026/11/26` (usage-light; source `RangeInput`) |
| U3 (med) InfoTooltip wall of copy | fixed | tooltip trimmed (done-02) |
| S6 (med) negative-margin spacing hack | fixed | reworked section spacing (done-02) |
| L10/L11 (low) cache-token rows; bold model ids | fixed | cache columns are quiet table columns (`缓存命中`/`缓存写入`); model ids render as plain row text, not bold headlines (usage-scrolled) |

### settings — before: `../ui-prototype-fidelity/screenshots/settings-light-production.png` / `-dark-` · after: [light](after/settings-light.png) [dark](after/settings-dark.png) [scrolled-light](after/settings-scrolled-light.png) [scrolled-dark](after/settings-scrolled-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| L7 (med) project dir raw absolute path | fixed | row uses `formatPath` (`~`-collapse). Capture shows `未设置` because the wizard flow in the supplementary run doesn't persist a default project dir; unit-tested helper + same code path as library (residual: no visual evidence of a real `~/…` path in this capture set) |
| L8 (med) config-error raw path | fixed | humanized + behind disclosure (done-02); error state not triggered in capture |
| S7 (med) settings card re-implements glass | fixed | composes shared card treatments (done-02) |
| S8 (med) 13.5px fractional font sizes | fixed | zero fractional font sizes remain in `packages/ui/src` (grep-verified: no `*.5px` anywhere) |
| U5 (med) model card summary truncates | fixed | summary now shows only the model id (`fixture-art-fast` …), format moved into expanded editor; no ellipsis (settings-light/dark) |
| U8 (med) About row cramped, inconsistent icons | fixed | `Novelive v0.0.0 · AGPL-3.0` headline + tagline below; all four links carry icons (检查更新 has a refresh icon) (settings-scrolled-light/dark) |
| L12 (low) format enum in card summary | fixed | no `OpenAI Chat Completions` in summary rows |

### import — before: `../ui-prototype-fidelity/screenshots/import-light-production.png` / `-dark-` · after: [light](after/import-light.png) [dark](after/import-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| leak4 (high) wizard shows raw backend exceptions | fixed | errors mapped via `humanizeError` (source; error path not triggered in happy-path capture) |
| ux7 (med) step 3 mislabeled `改编设置` | fixed | steps read `1 选择文件 / 2 核对信息 / 3 插图与参考` (import-light/dark) |
| ux8 (med) radio detached from picker | fixed | `放进哪里` radio sits above the picker it controls (import-light/dark) |
| leak10 (med) series select falls back to raw seriesId | fixed | `未命名系列` fallback (source) |
| leak13 (med) full paths end-truncated | fixed | `formatPath` tilde-collapse + middle truncation (source); no path visible at step 1 |
| style5 (med) inline styles on volume/chapter inputs | fixed | migrated to stylesheet (done-03) |
| ux10/ux11 (med) dense illustration labels; unexplained encoding picker | fixed | tightened labels + lead-in copy (done-03) |

### work — before: `../ui-prototype-fidelity/screenshots/work-light-production.png` / `-dark-` · after: [light](after/work-light.png) [dark](after/work-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| leak1 (high) chapter issue raw `[network] …` | fixed | ch2 failure renders `需要处理` chip + humanized tooltip `无法连接模型服务，请检查网络后重试。`; zero bracketed codes (work-light/dark). Companion evidence: m1b-gate spec migrated off `\[invalid_config\]` assertion |
| ux4 (high) issue duplicated inline+tooltip | fixed | rows show status chip + tooltip only; no inline duplication (work-light) |
| leak5 (high) WorkProduction error page raw `error.message` | fixed | `humanizeError` per project error codes (source; error page not triggered in capture) |
| leak8 (high) custom-mark CSS source in settings drawer | fixed | live-rendered sample + CSS behind `详细信息` (editor evidence; same `Details` pattern) |
| leak9 (high) raw writerPresetId fallback | fixed | falls back to `默认预设` (source) |
| ux5 (med) queue-position double +1 | fixed | unified `queuePosition` helper (source `pages/work/queue.ts`) |
| ux6 (med) `已停止` chip on never-started works | fixed | preview phase renders nothing/未开始 path (source; `已停止` only when production actually started — visible state `制作中 · 已停止` is the stopped-after-start case, correct) |
| leak12 (med) export dialog raw error | fixed | `humanizeError` (done-03) |
| style1 (high) divergent link-buttons | fixed | shared `ButtonLink` across work/production/confirm (source) |

### confirm-visual — before: `../ui-prototype-fidelity/screenshots/confirm-visual-light-production.png` / `-dark-` · after: [light](after/confirm-visual-light.png) [dark](after/confirm-visual-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| leak7 (high) raw entity ids (`UNIFORM`) for unnamed costumes | fixed | character tab reads `Ada · 造型 1 · 未选定`; no uppercase raw ids anywhere (confirm-visual-light/dark). Nit: legend reads `造型 · 造型 1` — duplicated word when fallback ordinal is used (reads correctly as `造型 · 蓝色制服` when the backend supplies a name); cosmetic only, not a leak |
| style6 (med) empty-state inconsistency | fixed | shared `EmptyState` with icon+text+action (source) |

### confirm-first — before: `../ui-prototype-fidelity/screenshots/confirm-first-light-production.png` / `-dark-` · after: [light](after/confirm-first-light.png) [dark](after/confirm-first-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| leak11 (med) raw ISO language codes `ja → zh-CN` | fixed | `formatLanguage` shared helper; pair hidden when source==work language (zh-CN both, as in cassette); no raw codes visible |
| ux9 (med) no loading/empty state for scenes | fixed | loading/empty states added (done-03) |
| style10 (med) cramped title+aside | fixed | header reads `第 1 章 · 第一章 纸船 · 1 个场景` — trimmed to label+count (confirm-first-light) |

### production — before: `../ui-prototype-fidelity/screenshots/production-light-production.png` / `-dark-` · after: [light](after/production-light.png) [dark](after/production-dark.png) [runrecord-light](after/production-runrecord-light.png) [runrecord-dark](after/production-runrecord-dark.png) [stale-light](after/production-stale-light.png) [stale-dark](after/production-stale-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| leak1 (high) raw provider error as chapter issue | fixed | ch2 row shows humanized `无法连接模型服务，请检查网络后重试。` (production-light/dark) |
| leak2 (high) run-record detail raw enum (`budget_paused`) | fixed | record detail humanized via `errorKind` contract + localized mapping (done-01 contract change; runrecord drawer shows `写剧本 · 完成` compose format) |
| leak3 (high) backend hardcoded zh `message` | fixed | contract now sends structured `status`+`errorKind`; UI composes `{{step}} · {{status}}` — visible as `写剧本 · 完成` (runrecord-light/dark) |
| leak6 (high) stale drawer raw assetKey title/toast | fixed | card title `Room · Day` — humanized-slug fallback per maintainer decision (cassette bible carries no description for `room/day`; descriptions resolve when present, cf. editor's `蓝色制服`). Toast likewise humanized (source) |
| ux2 (high) stale drawer no keep action, no cascade info | residual+fixed | cascade info now present: `重画后第 1 章的 1 个场景会一起换新图` (stale-light/dark). **No 保留 button — documented backend-limited residual (done-03): no write path exists to clear a stale mark without redrawing** |
| ux1 (high) run-record drawer shadow of spec | residual | backend-limited (done-03): records exist only at step completion for write/review/stage; no live/draw records. Copy no longer over-promises. The streaming/tool-card parity with agent panel remains unimplemented — backend contract work |
| ux3 (high) two stacked h2 headlines | fixed | painting chapter demoted to quiet secondary line `同时出图：第 N 章` (source; not simultaneously exercised in capture) |
| style2 (high) queue heading duplication + missing thumbs | fixed | see shell/queue |
| style3 (high) chapter numbering divergence | fixed | one `formatChapterLabel`/`formatChapterNumeral` family: rows `01`/`02` numerals + prose `第 N 章` (all captures consistent) |
| style4 (med) fractional 13.5/12.5px fonts | fixed | zero fractional font sizes in `packages/ui/src` (grep-verified) |
| ux7 (med) chip tone for queue position | fixed | `<Chip active>` only for active/producing; quiet chip for position (source) |

### editor — before: `../ui-prototype-fidelity/rework2/editor-light-production.png` / `../ui-prototype-fidelity/rework2/editor-dark-production.png` · after: [light](after/editor-light.png) [dark](after/editor-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| L1 (high) stage footer raw asset ids `room · day` / `Ada/uniform/neutral` | fixed | footer reads `背景 · Room · Day` / `立绘 · Ada · 蓝色制服 · Neutral` — consistent `·` separators, costume resolved to Chinese description `蓝色制服`, remaining Latin fragments are the maintainer-sanctioned humanized-slug fallback for assets with no registered description (cassette registers descriptions only for `room/rain` and `ada/uniform/furious`, neither on stage in this scene) |
| L2 (high) expression picks raw ids | fixed | same resolution path as L1 (source: `formatAssetLabel` + bible descriptions threaded through) |
| L3 (high) mark banner raw CSS | fixed | banner now: `新标记：dusk-glow` + live rendered sample (`示例文字` with styles applied) + `逐字/整段`; CSS moved behind collapsed `详细信息` (editor-light/dark). Nit: the mark slug `dusk-glow`/`boat-trail` remains as the banner title — it is the entity's user-facing handle (same name the toolbar menu uses after acceptance), borderline-accepted |
| L6 (high) history meta raw line ids / NVS lines | fixed | NVS humanizer strips `#xxxx`/`cont` tails, renders via `parseSentenceLines`+`RichText` (done-04; drawer not captured in this set) |
| L8 (high) source panel `p0001 ·` prefixes | fixed | paragraph ids dropped; ranges render `原文第 1–5 段` (source) |
| L4/L5/L7/L9/L10 (med) hunk `h3` / NVS directives / `p0007` instruction / hex scene fallback / `ch0001` chapter fallback | fixed | ordinal fallbacks `第 N 处`/`第 N 场`/`第 N 章` throughout (done-04) |
| L11 (med) `NVS 剧本` jargon panel title | fixed | renamed (done-04) |
| L14 (med) compile diagnostics run-on + ids | fixed | pre-wrap fixed + humanized diagnostics (done-04) |
| S1/S3 (med) bespoke empty states / third button style | fixed | canonical `EmptyState`/`Chip` (done-04) |
| U7 (med) save errors mention invisible IDs | fixed | reworded without ids (done-04) |
| U10 (med) rewrite hunks lack positional context | fixed | `第 N 处` ordinals (done-04) |

### bible — before: `../ui-prototype-fidelity/screenshots/bible-light-production.png` / `-dark-` · after: [light](after/bible-light.png) [dark](after/bible-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| L15 (high) raw `ch0001` everywhere | fixed | `首次出场 第 1 章` in list + detail; no `chXXXX` anywhere (bible-light/dark) |
| L16 (high) raw costume/expression/variant ids | fixed | `蓝色制服` description displayed; `造型 1` ordinal fallback (bible-light). Expression `双眉压低…` shows description text |
| L17 (high) raw file paths in 参考图 | fixed | paths dropped (done-05); no `<code>` paths visible |
| L18 (med-high) Fields dump `章节: ch0003` | fixed | chapter-aware `StructuredValue` formatting (done-05) |
| L19 (med) volume fallback `卷 v0001` | fixed | ordinal `第 N 卷` (header `第 1 卷` visible) |
| L20 (med) occurrence rows `ch0001 · p0003` + jargon | fixed | `出现位置` section present (empty in capture, `(0)` count); rows use `第 N 章 · 第 M 段` (done-05) |
| L22 (med) title() raw entry ids | fixed | synthesized per-kind titles (done-05) |
| U1 (high) Fields dense recursive dump | fixed | curated per-kind rendering: `外貌`/`锚点特征`/`造型与表情` sections with Chinese keys (bible-light) |
| U2 (med, data) English model output `black hair` as color values | residual | pipeline/prompting issue, explicitly not UI-fixable per research note — values visible as `black hair`/`blue eyes` in captures; flagged for the pipeline effort |
| S6/S7 (med) slider ` 章` suffix hack; chip polarity | fixed | locale-safe slider label; consistent candidate chip treatment (done-05) |
| U5 (med) proposal status filler `待确认` | fixed | warning banner explains stale state (done-05) |

### player — before: `../ui-prototype-fidelity/rework2/player-light.png` / `../ui-prototype-fidelity/rework2/player-dark.png` · after: [light](after/player-light.png) [dark](after/player-dark.png) [sysmenu-light](after/player-sysmenu-light.png) [settings-light](after/player-settings-light.png) [saveload-light](after/player-saveload-light.png) [history-light](after/player-history-light.png) (+ dark variants)

| Finding | Status | Evidence / reason |
|---|---|---|
| L15 (med-high) raw chapterId fallback in history/saves | fixed | `chapterLabelFor` falls back to `未知章节`; history groups render `第 1 章 · 第一章 纸船` (player-history-light/dark; redundancy is cassette data: chapter title literally starts with `第一章`) |
| L17 (med) milliseconds in text-speed setting | fixed | unitless `慢`/`快` slider, no `ms` anywhere; `瞬间显示` toggle removed (player-settings-light/dark) |
| U10 (med) 瞬间显示 toggle fights slider | fixed | toggle gone (same evidence) |
| L16 (low-med) legacy-save version/slot jargon | fixed | wording humanized; legacy panel only appears in load screen (source; no legacy saves in capture data) |
| U7 (med) slot card title `槽位 N` | fixed | filled slots title = `第 N 章 · line excerpt`; `存档 N` demoted to secondary line; empty slots read `空存档位` (player-saveload-light/dark) |
| U9 (low-med) legacy panel in save screen | fixed | rendered only when `view === 'load'` (source) |
| S6 (med) bare unstyled `打开本地工程` button | fixed | shared `Button` (done-06) |
| S7 (med) unstyled error `<p>`s | fixed | `ErrorNotice` throughout player surfaces (source) |
| S8 (med) raw px literals in overlay css | fixed | token-audited (done-06) |
| L18 (low-med) compiler jargon as player error | fixed | humanized container + details disclosure (done-06) |
| U5 (med) dead 在编辑器中打开这里 menu item | fixed | hidden when not linkable (done-06) |
| U14 (med) fullscreen error for transient failures | fixed | severity-appropriate presentation (done-06) |

### agent — before: `../ui-prototype-fidelity/screenshots/agent-light-production.png` / `-dark-` · after: [light](after/agent-light.png) [dark](after/agent-dark.png) [proposal-light](after/agent-proposal-light.png) [proposal-dark](after/agent-proposal-dark.png)

| Finding | Status | Evidence / reason |
|---|---|---|
| L1 (high) raw snake_case tool names as card titles | fixed | titles `读取设定集` / `查看第 2 章剧本` / `提议重写场景` (agent-light/dark) |
| L2/L3 (high) raw JSON keys as row labels | fixed | curated Chinese rows e.g. `条目 守塔人`, `章节 第 2 章 · 灯火`, `要求 统一称呼` (agent-proposal-dark) |
| L4 (high) raw JSON dump default-expanded | fixed | collapsed `详细信息` disclosure (arrow closed in agent-dark); no `原始数据` label anywhere |
| L5 (high) `Proposal <uuid> is awaiting…` English+UUID result | fixed | suppressed for propose tools — absent in both captures even though the fixture feeds it verbatim |
| L6 (high) spawn_agent double exposure | fixed | no spawn tool card; subtask card carries `核对第二章里守塔人的称呼是否与设定一致` + localized `审稿` role badge (agent-light) |
| L7 (high) raw English role as subtask title | fixed | human task text as title + role as localized chip (same evidence) |
| L8 (med) raw chapterId in impact line | fixed | `影响 第 2 章 · 灯火` (agent-proposal-light/dark) |
| L9 (med) raw asset path-id in redrawImage card | fixed | `formatAssetLabel` humanizer (source; redraw card not in fixture) |
| L10 (med) hunk ids `h1`/`h2` as checkbox labels | fixed | `第 1 处改动` / `第 2 处改动` (agent-proposal-light/dark) |
| L11 (med) rewrite diff in mono font | fixed | diffs render in body font (same evidence) |
| L12 (med) context chip leaks ids | fixed | entry names resolved via map; no raw fallback (done-07) |
| S1/S2 (med) thinking copy / pulse animation | fixed | prototype copy + pulse removed (done-07) |
| S4/S5 (med) send button shape / hand-rolled buttons | fixed | shared `Button`, circular send (done-07) |
| U1 (high) wall of noise in expanded card | fixed | expanded card shows 1–3 curated rows + checks + collapsed disclosure only (agent-dark expanded `读取设定集` evidence) |
| S13 (med) dead image placeholder icon | fixed | real image rendering via resourceUrl (done-07) |

---

## Cross-cutting verification

- **Fractional font sizes:** zero `*.5px` in `packages/ui/src` (grep-verified). One remaining raw `font-size: 15px` in `player/controls/controls.css:378` (player stage skin area).
- **Dark-theme contrast:** objective pixel measurements on `production-dark` error text — 9.7:1; muted table text in `usage-scrolled-dark` — 5.4:1; primary text 8.6–14.3:1. All pass WCAG AA. Vision-model "dim" reports were measured and rejected as false positives (quiet text is intentionally quieter by design).
- **Native scrollbars:** covered by e2e assertions (`capture()` helper in m1b-gate and others assert zero native scrollbars).
- **Locale spacing:** `第 N 章`/`第 N 卷` keys carry half-width spaces in all locale files (source-verified); vision OCR occasionally renders them tight but the DOM strings are correct.

## Findings needing rework

None — no FAILED items. All high/medium findings are fixed or carry documented residuals accepted by the owning tasks:

1. **residual — owner: gate/backend (out of 02–07 scope):** stale-asset drawer has no `保留` action; no backend write path exists to clear a stale mark without redrawing (done-03). Also: live/`出图` run records cannot exist — backend emits records only at write/review/stage completion.
2. **residual — owner: pipeline effort (not UI):** bible key-color values render English model output (`black hair`) in a zh UI — prompting/backend matter per research note U2.
3. **residual — owner 02 (accepted):** library/usage paths outside `$HOME` render absolute rather than collapsing; research suggested drop-or-tooltip as the cleaner end-state. Evidence artifact: captures necessarily use `/tmp` roots, so the absolute path is visible in library shots.
4. **residual — owner 02 (accepted):** queue-drawer rows navigate away and close the drawer without feedback (done-02 d); welcome keeps its custom stepper dots.
5. **cosmetic nits (no rework needed):** `造型 · 造型 1` duplicated word in confirm-visual legend when ordinal fallback is used; editor mark-proposal banner titles use the mark slug (`dusk-glow`) — the same user-facing handle the toolbar exposes after acceptance.

## Linux AppImage

pending
