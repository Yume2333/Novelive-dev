# UI polish audit (2026-11-26)

**Status:** closed
**Audited revision:** `ui-prototype-fidelity/integration` (post tasks 01–07, before gate 08 landed)
**Decisions:** maintainer answered on 2026-11-26 — see `decisions.md` 「UI 打磨:显示名、用量、原始数据与错误码」.

Four read-only audits of `packages/ui/src/` against `DESIGN.md`, `docs/ux.md`, `prototype/src/` and production screenshots. Line numbers refer to the audited revision; re-locate by symbol before editing.

---

## UI Audit Report — App Shell & Global Pages

Surface audited: `shell/`, `pages/welcome/`, `pages/library/`, `pages/usage/`, `pages/settings/`, `pages/library/share/`, `components/`, `styles/`, and zh-CN/en locales. Grounded against `DESIGN.md`, `docs/ux.md`, the prototype, and production screenshots (`settings-light-production.png`, `usage-light-production.png`, `library-light-production.png`).

### 1. Leaked technical detail

| # | Severity | `file:line` | What is shown | Who sees it | Recommendation |
|---|----------|-------------|---------------|-------------|----------------|
| L1 | **high** | `pages/usage/UsagePage.tsx:635` | Raw `record.link.volumeId` (format `joined-<uuid>` per `creator/src/project/series/join.ts:67`) in every row of the 「已发生用量」 list, e.g. `paper · joined-9f3c… · 写` | all creators | Hide. The volume is meaningless without the series; if volume context is needed, resolve to the volume title (already loaded for works) or drop the segment entirely |
| L2 | **high** | `pages/usage/UsagePage.tsx:391-394` | `unreadableProjects` rendered as `{{projectId}}：{{reason}}` — `projectId` is the binding-file name = the work's raw UUID (`creator/src/project/library.ts:17` names binding files by workId) | all creators hitting an unreadable project | Replace with the project directory or last known title; at minimum humanize to "一部作品无法读取" + reason, dropping the UUID |
| L3 | **high** | `pages/usage/UsagePage.tsx:672-675` | 「过期素材」 rows show raw `asset.assetKey` (internal manifest id shaped `character/costume/expression`, e.g. `linbo/schooluniform/smile` — English slugs, see `creator/src/pipeline/art/plan.ts:74-77`) plus raw `asset.workId` UUID on the next line | all creators | This whole section duplicates the production page's StaleAssets drawer. Either resolve asset keys to character/place names and work titles, or drop the section from usage entirely (it is not usage data — ux.md defines 用量 as token/成本统计; stale-asset handling belongs to 制作) |
| L4 | **high** | `shell/AppShell.tsx:521` | `work?.title ?? workId` — when the work fails to load, the sidebar「当前作品」title falls back to the raw UUID | creators with a corrupted/unreadable project | Humanize: show `无法读取的作品` or the last path segment of the project directory |
| L5 | **high** | `pages/usage/UsagePage.tsx:247` | `titleOf` falls back to raw workId UUID in filter dropdown and per-work table rows when the work no longer exists in the library | anyone whose deleted project still has usage records | Fallback should be `已删除的作品` (or keep last-known title in usage records) — never the UUID |
| L6 | **med** | `pages/library/LibraryPage.tsx:572` (`styles.groupPath`) | Series group heading shows raw absolute `project.directory` path. Screenshot evidence: `/tmp/uip08-final-G80cC9/projects/paper` — an unreadable machine path. Prototype intent (`prototype/src/pages/library/LibraryPage.tsx:299`) is a humanized home-relative path `~/文档/Novelive/雾海纪行` | all creators with grouped series | Humanize: substitute `$HOME` → `~`; consider dropping the path entirely since the series title is the grouping key and the path is noise for non-technical users (or move it into a tooltip) |
| L7 | **med** | `pages/settings/SettingsPage.tsx:577` | 「默认工程位置」 row shows raw absolute `config.projectDir` | all creators | Same `~` humanization; this one is user-chosen so keeping a path is correct, just format it |
| L8 | **med** | `pages/settings/SettingsPage.tsx:471` | Config-file error box prints raw `config.configError.path` (absolute path to the JSON config) | users with corrupt config | Keep the path (user may need to delete the file) but humanize with `~`; put it behind the「详细信息」pattern or keep as-is — it's an error-recovery path, acceptable at low priority |
| L9 | **med** | `pages/usage/UsagePage.tsx:52-56` (`money`) | Cost precision: amounts < $1 render with **4 fraction digits** (`$0.0423`); larger amounts with 2 | all creators looking at cost | Round to cents and render sub-cent totals as `< $0.01` — 4-digit dollar precision reads as debug output |
| L10 | **low** | `pages/usage/UsagePage.tsx:662-668` | Token rows print `缓存读取 X / 写入 Y` raw cache-token counters — internal API billing mechanics end users don't understand | creators | Keep input/output; move cache read/write into a tooltip or drop (the ux.md spec for usage only requires 输入、输出和缓存读/写 — so it *is* sanctioned; but consider friendlier labels like `缓存命中` instead of `缓存读取`) |
| L11 | **low** | `pages/usage/UsagePage.tsx:630` | `<strong>{record.model}</strong>` — raw model id (`devin-swe-2`, `fixture-art-fast`) as the boldest element of each row | creators | Borderline keep: users type these ids themselves in settings. But visual emphasis is wrong — model id should be secondary text, the work/phase should lead. Screenshot confirms `fixture-art-*` ids front and center |
| L12 | **low** | `pages/settings/ModelFields.tsx:28-31` + `SettingsPage.tsx:373` | `formatLabel` falls back to the raw enum string (`openai-completions`) if an unknown format is stored; the known-format labels are English API names (`OpenAI Chat Completions`) inside the zh-CN card summary | creators | Sanctioned by ux.md (users pick the format), but the card summary line `未填模型 · OpenAI Chat Completions` truncates with ellipsis at normal width (screenshot evidence) — consider showing only the model name in the summary and the format inside the expanded editor |
| L13 | **low** | `shell/AppShell.tsx:434-435, 496` | Sidebar meta line `v{{version}} · 已发布 x/y 章` for packages and `{{series}} · 第 n 卷` — fine; but `parsePackageRef` storage ref `package:<workId>:<version>` never leaks. No action | — | keep |
| L14 | **low** | `pages/settings/SettingsPage.tsx:145,286` | `data-error-code` DOM attributes expose internal codes (`auth`, `context_limit`) | invisible to end users (test hook) | keep — not user-visible |
| L15 | **low** | `shell/AppShell.tsx:576` | Warning banner 「日志」 button opens the log directory — the concept "logs" is developer-flavored but it is the recovery path ux-wise | creators in a failure state | Rename to something like「查看诊断信息」or keep — low priority; copy is terse but acceptable |

### 2. Style inconsistency

| # | Severity | `file:line` | Divergence | Canonical pattern |
|---|----------|-------------|------------|-------------------|
| S1 | **high** | `pages/library/LibraryPage.tsx:484,486,549,551`, `pages/usage/UsagePage.tsx:380-381` | Error/loading states are bare unstyled `<p role="alert">` / `<p role="status">` — no icon, no banner, no `Banner` component, no spinner. Settings uses styled `.warning` with icon (`SettingsPage.tsx:466`); production queue drawer uses `<Banner kind="error">` | `<Banner kind="error">` / a shared `<LoadingState>` — three different error renderings across sibling pages |
| S2 | **high** | `pages/usage/UsagePage.tsx:385-396` | 「部分项目无法读取」 is a raw `<section role="alert">` with unstyled `<h2>`/`<ul>` — no banner styling at all, visually indistinguishable from body text | Should be `<Banner kind="warning">` like every other alert in the app |
| S3 | **med** | `pages/library/LibraryPage.tsx:491-510` vs `:554,615` | Two empty-state conventions on the same page: the main empty state wraps `<EmptyState>` inside `<Card>` manually; tab empty states use `<EmptyState card />` prop | `<EmptyState card>` is the canonical prop — the `<Card>` wrapper double-frames the glass panel (`.emptyCard` already renders its own glass panel) |
| S4 | **med** | `components/Page.tsx:66-77` (`.primary` in Page.module.css) | `PageAction` is a *link styled as a primary button* with font-size 13px / gap `--space-1`, while `Button variant="primary"` is 12px / `--space-2` — the two primary actions look different when both appear in one header (LibraryPage header mixes `<PageAction>` 新建工程 with `<Button>` 导入作品包). Also `PageAction` doesn't participate in `nl-btn` transitions/scale | Make `PageAction` render the same `nl-btn nl-btn-primary` classes as `Button` (or a shared `buttonClasses()` helper) — one primary-button implementation |
| S5 | **med** | `components/Page.tsx:18-19` | `Page` accepts both `actions` and `action` ("Alias kept for existing callers") — two prop names for one slot across pages | Clean cutover: migrate all `action=` callers to `actions=`, delete the alias |
| S6 | **med** | `pages/usage/UsagePage.module.css:17-19` | `.content > .filters` uses negative margin compensation `calc(var(--space-6) - var(--space-7))` to cancel grid gap — fragile spacing hack; gaps between sections on this page don't follow the 区块之间 48px rule consistently | Rework to explicit section spacing per DESIGN.md 间距 rules |
| S7 | **med** | `pages/settings/SettingsPage.module.css` vs `components/Card.module.css` | Settings `.card` re-implements the glass card by hand (`border`, `border-radius: var(--radius-2xl)`, `background: var(--panel-70)`, `box-shadow: var(--shadow-glass)` — line 17-22) instead of using the shared `Card`/`glass-panel` classes; library cards use `glass-panel` directly; usage panels use `<Card>` — three card constructions | One `Card` component / `glass-panel` utility everywhere; settings should compose it |
| S8 | **med** | `pages/settings/SettingsPage.module.css:63` `font-size: 13.5px`; `:228` `13.5px` | Off-scale font sizes (13.5px) recur in settings; other pages use 12/13/14 | Pick 13 or 14 — font sizes shouldn't be half-pixel one-offs |
| S9 | **low** | `shell/AppShell.module.css:164-184` (`.themes`) | Theme switcher is a hand-rolled pill-shaped segmented control with `--radius-full` on both container and buttons — container pill is fine (circular icon buttons inside), but it's the only segmented control of its kind; the same function in settings is a `CompactSelect` — two different UIs for the same setting | Acceptable duplication (sidebar affordance), but consider a shared `SegmentedControl` if a third instance ever appears |
| S10 | **low** | `pages/library/LibraryPage.module.css:44` | `.volumeTitle` uses shorthand `font: 600 13px var(--font-body)` while everywhere else font-size/weight are separate properties | cosmetic; unify |
| S11 | **low** | `components/Form.tsx:30-52` | `inputStyle`/`textareaStyle` are exported as JS objects and merged inline (`padding: '10px 14px'`, `fontSize: 14`) while `.nl-input` CSS class also exists — two competing input-styling mechanisms, and inline styles defeat the dark-theme refinements | Move all input styling into the CSS module / `.nl-input`, delete the JS style objects |
| S12 | **low** | `pages/welcome/WelcomeModels.tsx` vs `pages/settings/ModelFields.tsx` | The welcome flow re-implements the model form (formats list duplicated at `WelcomeModels.tsx:19-23`, api-key masking logic duplicated `:136-138`) instead of reusing `ModelFields` — copy drift already visible: welcome lacks the「兼容哪家」selector entirely, so users who configure in welcome never set compat | Share the field components; welcome keeps only its simplified layout |
| S13 | **low** | `pages/library/LibraryPage.module.css:37` | `.card` uses `border-radius: var(--radius-xl)` while `Card` component uses `--radius-2xl` — library cards visually rounder-consistent? Actually library overrides to xl; settings cards use 2xl; usage panels 2xl — card radius differs per page | One card radius (`--radius-2xl` per Card) or document xl as the compact-card variant |

### 3. UX / display problems

| # | Severity | `file:line` | Problem |
|---|----------|-------------|---------|
| U1 | **high** | `pages/usage/UsagePage.tsx:617-690` | 「已发生用量」 list is an unbounded dump of every individual call (one row per API call — hundreds of rows of dense 12px text: model id, uuid volume id, 4 token counters, timestamp). This is a debug log, not a statistics view. Columns wrap awkwardly (`overflow-wrap: anywhere`), the grid is 2-column so the long middle span collides with the time column. Recommend: collapse to daily/per-model aggregates, or cut the section entirely — the table above already answers 按作品×阶段 |
| U2 | **high** | `pages/usage/UsagePage.tsx:414-432` | Date-range inputs show browser-native `mm/dd/yyyy` format and English month names in a zh-CN UI (screenshot evidence: `mm/dd/yyyy` placeholders). Browser locale decides; Electron may not follow app language — needs explicit lang wiring or custom inputs |
| U3 | **med** | `pages/usage/UsagePage.tsx:443-447` | InfoTooltip text is a wall of dense copy mixing three unrelated facts (billing basis, no-budget disclaimer, stale-style policy) — the last sentence「风格变更仅提示，不自动标记图片过期」is irrelevant on a usage page. Split/trim |
| U4 | **med** | `pages/library/LibraryPage.tsx:566-580` | Series group heading renders `[icon] SERIES-TITLE /raw/abs/path` — the uppercase-caps series title + lowercase path collision looks broken (screenshot: `PAPER /tmp/uip08-final-G80cC9/...`); `.groupPath` sets `text-transform: none` but inherits odd letter-spacing reset. Prototype separates with `·` and a humanized path |
| U5 | **med** | `pages/settings/SettingsPage.tsx:373-380` | Model card summary `model · format · 同快速模型` truncates with ellipsis at default width for the common case (`fixture-art-main · OpenAI Chat Completion…` in screenshot) — the summary never fits; either drop the format from the summary (see L12) or widen |
| U6 | **med** | `pages/library/LibraryPage.tsx:557-560` | 「有 n 部作品无法读取」 alert names a count but gives the user neither a reason nor any action — dead-end error. Should say what can be done (check the project folder) or link to details |
| U7 | **med** | `pages/welcome/WelcomePage.tsx` stepper | `Dots` step indicator is custom-built (`WelcomePage.module.css:80-98`) while the component library already exports `Stepper` (`Extended.tsx:373`) — and neither matches the other. Welcome dots are fine aesthetically, but two step components is drift; also step 2「模型配置」in welcome has no explanation of what the four text models *do* — non-technical creators face 5 model fields plus a second image-model block on first run |
| U8 | **med** | `pages/settings/SettingsPage.tsx:599-617` | About row layout: `<strong>Novelive</strong>` + tagline + `v0.x · AGPL-3.0` — the version/license tail is cramped into the same flex row as the title, and the four link buttons below are plain text buttons with inconsistent icons (3 have ExternalLink, 检查更新 has none) — misaligned visual rhythm |
| U9 | **med** | `shell/GlobalProductionQueue.tsx` + `ProductionQueuePanel.tsx` | Drawer reuses the production page's queue panel wholesale: rows link to `workRoute('production', …)` *inside a drawer that closes on navigation* — the drawer just disappears on click (pathname effect closes it), no confirmation the nav happened. Also「立即停止」danger button sits directly on the active row with no confirmation inline — the ConfirmDialog exists but the drawer stays open behind it (z-order/stacking is correct but visually noisy). Minor: drawer width 400 vs panel designed for full-width production page — rows squeeze |
| U10 | **low** | `pages/library/LibraryPage.tsx:246` | Reading progress and production progress compete in the same card footer: `已读 x/y 章` percent in accent color right under `已发布 x/y 章` — two progress bars stacked 5px+5px with two different meanings is confusing (screenshot shows both). Prototype shows one status line + one producing detail line |
| U11 | **low** | `pages/library/LibraryPage.tsx:170-176` | Imported works show bare `共 n 章` with `BookOpen` icon in quiet tone — no indication whether it's playable; the card is only a link when `published > 0` (`:608-614`), otherwise a dead `<div>` with zero affordance of why it doesn't react |
| U12 | **low** | `shell/AppShell.tsx:449` | 「换一部作品」 switcher is a chevrons icon-only button squeezed against the work meta — easily missed; and its dropdown mixes projects and packages with no grouping (a `title` vs `title · v1.2` inconsistency in item labels) |
| U13 | **low** | `pages/usage/UsagePage.tsx:529-540` | Bar chart bars are `<button>`s whose only role is showing a tooltip — clicking does nothing beyond what hover does; bar count/labels: with few bars, numbers float above bars in tiny 11px grey; `labelEvery` logic hides labels but leaves empty `<span>` — visual noise |
| U14 | **low** | `pages/settings/production/ProductionSettings.tsx` | Nine role rows each with identical Bot icon — the icon carries no information, violates「列表行只放必要信息」; rows are dense and the role→slot mapping is a wall of sameness. Also 「EPUB 插图筛选」 role name is jargon exposed to non-technical users (acceptable — it's a power feature behind 高级) |

### Shared fixes that should live in one place (foundation task)

1. **`formatWorkTitle(titles, workId)` / `useWorkTitles()` helper** — one place that resolves workId→title with a humanized `已删除的作品` fallback; kills the UUID leaks in `UsagePage.tsx:247`, `AppShell.tsx:521`, and the stale-asset rows. (L1, L4, L5)
2. **`formatPath(dir)` humanizer** (`$HOME`→`~`, strip trailing slashes) in a shared `format.ts` — used by library group headings, settings project dir, config-error box. (L6, L7, L8)
3. **`formatCost(usd)` helper** — cents rounding + `< $0.01` floor, replacing the inline `money()` in UsagePage so every money display in the app agrees. (L9)
4. **Shared error/loading primitives**: `<ErrorBanner>` (wrapping `Banner kind="error"` with retry slot) and `<Loading>` (spinner + text) in `components/` — replaces every bare `<p role="alert">` / `<p role="status">` across library, usage, work pages. (S1, S2)
5. **One `PageAction`/`Button` primary implementation** — `PageAction` should reuse the `nl-btn nl-btn-primary` class chain; delete `action`/`actions` prop duplication on `Page` in the same pass. (S4, S5)
6. **`inputStyles` CSS-only consolidation** — delete `inputStyle`/`textareaStyle` JS objects from `Form.tsx`; one `.nl-input` implementation. (S11)
7. **Shared model-config field components** — extract `ModelFields` so welcome and settings render the same fields (including「兼容哪家」), differing only in layout density. (S12, U7)
8. **`VolumeLabel`/`formatVolume` helper** (`第 n 卷 · title`) — currently reassembled inline in library grouping, shell meta, and usage; if usage keeps any volume context it should be this label, never the id. (L1)
9. **Asset-key → display-name resolver** (or a decision to remove stale assets from the usage page entirely, since the production page already owns that surface). (L3)

---

## Audit: creator authoring flow (import / work / confirm / production)

Surface audited: `packages/ui/src/pages/{import,work,confirm,production}/**` + `locales/*/{import,work,confirm,production}.json`, cross-checked against `DESIGN.md`, `docs/ux.md`, the prototype, backend producers in `packages/creator/src/`, and the capture evidence in `.workflow/evidence/ui-prototype-fidelity/`.

---

### 1. Leaked technical detail

#### High

1. **Raw provider/model error strings as chapter `issue`, inline in chapter rows.**
   - `pages/production/ProductionPage.tsx:226-228` — `{issue}` rendered verbatim in `.issueLine` under the row.
   - `pages/work/WorkPage.tsx:344-352` — `chapter.issue` rendered **twice**: inside the row (truncated) *and* again as the Tooltip text.
   - `pages/production/ChapterState.tsx:22-24` — same raw text in Tooltip.
   - What users see (confirmed in `screenshots/production-light-production.png`): `[network] Model connection interrupted or unavailable` — English dev prose with a bracketed internal error code, inside a zh-CN UI. Backend origin: `packages/creator/src/models/text/index.ts:331` builds `` `[${code}] ${detail ?? descriptions[code]}` `` (all-English `descriptions` table at line 244-253); it flows unmodified into `run.error_message` → `chapterIssue()` (`scheduler/chapter/index.ts:1422-1449`) → snapshot `issue`.
   - Replacement: **humanize + localize** via a shared error mapper (see shared fixes). The raw string can move behind the run-record "详情" disclosure, but even there it should be the raw *detail*, not the headline.

2. **Run-record `detail` is a raw internal error enum.**
   - `pages/production/ChapterRecords.tsx:97-101` renders `record.detail` verbatim. Producer: `packages/creator/src/project/production.ts:486` — `detail: step.errorType`, where `errorType` is a snake_case internal kind: `budget_paused`, `reasoning_limit`, `portrait_framing`, `matting_unavailable` (`scheduler/chapter/index.ts:83,293-310,766`).
   - Who sees it: any creator who opens 运行记录 → 详情 on a failed step.
   - Replacement: map each errorType to a localized human sentence ("模型预算不足，已暂停" / "模型只输出了思考没有正文" / …); keep raw enum out of UI entirely.

3. **Run-record `message` is hardcoded zh-CN in the backend — untranslatable in en/ja/zh-TW UI.**
   - `packages/creator/src/project/production.ts:478-482`: literals `'已完成' / '已取消' / '运行失败'` baked into the event payload; `ChapterRecords.tsx:78` renders `record.message` as the card headline. An English-locale user sees Chinese text; worse, the message conveys no information beyond the status already shown by `StatusMark`.
   - Replacement: contract should send only `status` (+ optional machine detail); UI composes the message from `stepName` + status, or a humanized error line.

4. **Import wizard error banner shows raw backend exceptions.**
   - `pages/import/ImportPage.tsx:107-110` — `message()` extracts `error.message` verbatim into the Banner. Backend throws English dev strings: `'DOCTYPE is not supported'`, `'EPUB input limit exceeded'`, `'EPUB XML depth limit exceeded'`, `'TXT import requires an empty project'`, `'EPUB illustration list does not match import'` (`creator/src/import/**`).
   - Replacement: error-code contract + localized humanizer; generic fallback already exists (`t('导入失败，请重试。')`) but is only used for non-Error shapes.

5. **WorkProduction error page shows raw `error.message`.**
   - `pages/work/WorkProduction.tsx:42-48,100,133,174` — any IPC/contract failure (including raw project error codes' messages) is rendered as a bare `<p role="alert">` on an otherwise empty page titled "制作提示".
   - Note backend `projectErrorCodes` (`contract/project.ts:54-58`): `invalid_document`, `unsupported_format`, `unsupported_reader`, `unsupported_database` — these codes and their accompanying messages surface here when a project is corrupt or too new.
   - Replacement: humanize per code ("这个工程由更新版本的 Novelive 创建，请升级后打开" for `unsupported_reader`/`unsupported_database` etc.), keep the retry action.

6. **Stale-assets drawer uses raw `assetKey` as the card title and in the toast.**
   - `pages/production/StaleAssets.tsx:138` — `<div className={styles.staleName}>{assetKey}</div>`; asset keys are internal path slugs like `ada/uniform`, `school-rooftop/day`, `cg-9f2e` (`format/model/metadata.ts:17` `assetPathId`); also `StaleAssets.tsx:106` toast `「{{asset}}」重画完成` embeds the slug.
   - Prototype shows human labels: `第 X 章 · 场景 1 背景` + kind/reason (`prototype/src/pages/production/ProductionPage.tsx:28-43`).
   - Replacement: derive a display name — character/costume names from the bible where the key matches, or at minimum humanize the leaf (`uniform` → costume name); never show the raw key. (Same leak exists in `usage/UsagePage.tsx:674`, outside this surface but fixable by the same helper.)

7. **Confirm-visual falls back to raw entity IDs for unnamed characters/costumes.**
   - `pages/confirm/ConfirmVisualPage.tsx:245` `entry.characterName ?? entry.characterId`, `:265`/`476-477` `entry.costumeName ?? entry.costumeId`. Confirmed visible in `screenshots/confirm-visual-light-production.png`: character tab shows `uniform · 未选定`, section legend `造型 · UNIFORM` — a raw lowercase id uppercased by `label-caps`, meaningless to a creator.
   - Replacement: backend should always supply a display name (it nearly always can — costume names come from the bible); UI fallback should be a generic localized label ("造型 1") not the ID.

8. **Custom-mark CSS source dumped into the settings drawer.**
   - `pages/work/WorkSettings.tsx:148` — `<p className={local.markCss}>{mark.css}</p>` renders raw CSS code (`text-shadow: 0 0 6px …`) to non-technical creators. `markName` (`:144`) is also a raw identifier.
   - Replacement: show a live-rendered *sample* of the mark (the editor already has `effectiveMarkCss` for preview, `editor/EditorPage.tsx:1139`) instead of the source; if the CSS must be inspectable, put it behind a disclosure.

9. **Writer-preset fallback shows raw `writerPresetId`.**
   - `pages/work/WorkSettings.tsx:88` — `presetName ?? settings.writerPresetId ?? t('默认预设')`: when the preset lookup fails (preset deleted, or config unreadable) the raw entity id renders.
   - Replacement: fall back directly to `默认预设` (or "未知预设"), never the id.

#### Medium

10. **Series select falls back to raw `seriesId`.**
    - `pages/import/ImportPage.tsx:529` — `joinTarget.title || joinTarget.seriesId`; series titles are required in the schema but can be empty string in practice, showing e.g. `wenming` / slug.
    - Replacement: use title or a localized "未命名系列"; never the id.

11. **Raw ISO language codes in confirm-first header.**
    - `pages/confirm/ConfirmFirstPage.tsx:141-147,224` — `languagePair = ${sourceLanguage} → ${workLanguage}` renders codes like `ja → zh-CN` in the section label.
    - Replacement: reuse the localized language names table from import (`encodingNames`-style, e.g. `日语 → 简体中文`); share one `formatLanguage` helper.

12. **Export dialog shows raw `response.error.message`.**
    - `pages/work/share/ExportPackage.tsx:90,101` — share-layer errors surface unfiltered. Same humanizer as #4.

13. **Full filesystem paths with end-truncation.**
    - `pages/import/ImportPage.tsx:160-190` `PickerField` + `ImportPage.module.css:136-144` `.pickerValue` — full absolute path (`/home/shizuku/文档/Novelive/…`) shown, ellipsized at the **end**, which hides the meaningful tail (the project folder name). Same for join-target `projectDir` (`:475`).
    - Verdict: paths are legitimately user-facing here (creator chose the folder), but display should be tilde-shortened (`~/文档/Novelive/x`) and middle-truncated. The prototype shows `~/文档/Novelive/雾港来信` (prototype capture).

#### Low

14. **"第 N 段" paragraph ordinals in illustration picker.** `pages/import/ImportPage.tsx:870-884` — `使用插图 1 · 第 1 卷 · 第 2 章 · 第 3 段` is a long machine-y coordinate chain; the volume/chapter part is meaningful, the paragraph ordinal is noise for most creators. Consider dropping the paragraph segment or relegating to tooltip.

15. **`production.chapterRecord` timestamps.** `pages/production/ChapterRecords.tsx:88-90` — `new Date().toLocaleString()` follows OS locale (not the UI locale) and prints verbose seconds; inconsistent with the quiet 11-12px meta style elsewhere.

---

### 2. Style inconsistency

#### High

1. **Three divergent reimplementations of link-buttons/ghost-actions across the four pages** — violates DESIGN.md "优先复用组件 / 不在页面内重复实现同类组件":
   - `pages/production/Production.module.css:339-364` `.ghost` — 11px font, letter-spacing .08em, transparent border.
   - `pages/work/WorkPage.module.css:24-52` `.primaryLink/.buttonLink` — `font: inherit`, surface-container background.
   - `pages/confirm/Confirm.module.css:28-92` `.linkButton/.moreTrigger` — 12px, `space-px-10/20` padding, scale(.985) active.
   - `pages/production/Production.module.css:56-93` `.primary/.button` — yet another pair (36px min-height, `space-1/space-3` padding).
   - Same concept (a Link styled as primary/ghost button) should be one shared `ButtonLink`/`<Button as={Link}>` in the control library.

2. **Duplicated `制作队列` heading in the queue drawer** (already flagged in fidelity audit F1, still unfixed): `pages/production/queue/ProductionQueuePanel.tsx:62` unconditional `<h2>制作队列</h2>` inside a drawer that already carries the same title — visible double header in `screenshots/shell-light-production.png`. Queue rows also lack the prototype's 28×38 cover thumbnails (F2): `ProductionQueuePanel.tsx:148-162` — fixable UI-side with `GradientCover` seeded by workId.

3. **Chapter numbering format diverges across pages** — the same chapter appears as:
   - `01` / `02` zero-padded bare number — production rows (`ProductionPage.tsx:48`), work rows (`WorkPage.tsx:341`), import review (`ImportPage.tsx:786`);
   - `第 1 章 · 纸船` — confirm-first (`ConfirmFirstPage.tsx:211`), prototype headline;
   - `02 · 第二章 灯火` — production headline (`ProductionPage.tsx:400-427`);
   - `第{{value}}卷` no-space vs `第 {{index}} 卷` with spaces — `locales/zh-CN/import.json` key `第{{value}}卷` vs production/work keys `第 {{index}} 卷` (visible even in the screenshots: sidebar `第1卷` vs page header `第 1 卷`).
   - Canonical: rows keep the quiet zero-padded index as a *numeral column*; anywhere a chapter is referred to in prose it should be `第 N 章` (half-width spaces) — one shared formatter.

#### Medium

4. **Fractional font sizes off the de-facto scale.** `Production.module.css:451` `.recordStepName` 13.5px, `:462` `.recordMessage` 12.5px — everything else in the app uses integer 11/12/13/14. Align to 13px/12px.

5. **Inline style overrides instead of classes.** `pages/import/ImportPage.tsx:711-717` (volume title input: width 150, padding, fontSize 13, fontWeight 600) and `:794-798` (chapter title input) — hard-coded inline styles bypass the module stylesheet; also `width: 150` raw px.

6. **Empty-state pattern applied inconsistently:**
   - `ConfirmVisualPage` uses shared `<EmptyState>` with icon+text+action ✓;
   - `ConfirmFirstPage.tsx:255-265` renders a plain `<Card><p>目前没有待确认的第一章。</p>` + link — no icon, no EmptyState;
   - production/work chapter lists use bare muted `<p>暂无章节</p>` (`ProductionPage.tsx:478`, `WorkPage.tsx:459`);
   - `StaleAssets.tsx` EmptyState has `text` but no `title`, while `ChapterRecords` EmptyState has both.
   - Pick one canonical pattern (icon + optional title + text + action) and apply it to all.

7. **`chip` tone for queue position.** `ProductionPage.tsx:447-451` — queue position and work status share the same neutral `<Chip>`; prototype distinguishes `正在处理` as `<Chip active>` and position as quiet. Production page never shows the active (producing) emphasis state in the chip when queued positions exist — minor but visible.

8. **`--space-px-*` fractional spacing tokens proliferate in confirm** (`Confirm.module.css` `space-px-10/20` padding on buttons) while production/work use `space-1/2/3` — same component type (page-action buttons) with different padding scales.

#### Low

9. **zh-TW status word drift**: `locales/zh-TW/production.json` `空闲 → 閒置` while zh-CN uses `空闲`; DESIGN.md pins the four global status words — the zh-TW column should be the traditional rendering of the *same* words (`空閒`), not a synonym.

10. **`标题 + aside` cramped in confirm-first**: `ConfirmFirstPage.tsx:210-227` stuffs chapter title, scene count, language pair *and* the explanatory sentence `已发布，可以试玩，准备好后再手动继续制作。` into one SectionLabel line — exactly the "说明性小字" DESIGN.md bans from section headers; the prototype puts status copy in the metadata row but shorter. Trim to label + count.

---

### 3. UX / display problems

#### High

1. **"运行记录" drawer is a shadow of the spec.** `docs/ux.md`: "和 Agent 面板同一套显示（流式回复、可折叠思考、工具调用卡片、子任务）"; prototype implements this with `MessageParts` per step. Production `ChapterRecords.tsx` shows only: a one-line message (completed/cancelled/failed), a timestamp, and a raw enum detail. Additionally:
   - **出图 step never appears** — backend filters `['write','review','stage']` (`project/production.ts:475`), so the promised "写 → 审稿 → 演出 → 出图" four-step record is impossible even though the empty state promises it (`ChapterRecords.tsx` empty text).
   - **No "进行中" record can ever exist** — `run_step` rows are written only at step completion (`scheduler/chapter/index.ts:756,766`), so the `running` status UI is dead code; creators watching a live chapter see an empty drawer until each step finishes.
   - This is partly backend, but the UI effort should define the target and at minimum fix copy/humanize.

2. **Stale-assets drawer offers no "保留" (keep) action.** `docs/ux.md`: "由创作者决定重画或保留"; prototype has 重画/保留 with cascade explanation (`重画后第 X 章的 3 个场景会一起换新背景`); production `StaleAssets.tsx` only has 重画, no cascade info, and a generic `上游设定或参考图已更新` reason for every card. Also `重画返回了候选结果，请到编辑器中挑选` error path (line 110) is confusing — the user asked for one image; being sent to the editor with no deep link is a dead end.

3. **Two stacked `<h2>` headlines when writing and painting chapters coexist.** `ProductionPage.tsx:398-427` renders both `painting` and `writing` headlines as sibling `<h2>`s under one "当前章节" label — the prototype structures this as a column with one visual hierarchy and an extra image-queue line. At minimum demote one; ideally show writing chapter as headline + a quiet secondary line for the painting chapter.

4. **Work-page issue text truncation + duplication.** `WorkPage.tsx:344-352`: the raw issue renders inline in an ellipsis-truncated span *and* in a tooltip with identical text — row space is precious, the English string can be very long, and the tooltip adds nothing. After humanizing, show only the Tooltip (production `ChapterState` pattern) or the short localized tag.

#### Medium

5. **Queue-position math is inconsistent between pages.** `WorkPage.tsx:56-62` `queuePosition` returns `index+1` for queued works and then `QueueChip`/`PhaseCard` display `position + 1` (`:95`, `:214`) — double +1: when no work is active, the next-up work reads "排在第 2 位" instead of 第 1 位. `ProductionPage.tsx:268-270` computes differently (accounts for active). Unify in one helper with one definition.

6. **`已停止` chip shown for never-started works.** `WorkPage.tsx:97-99` QueueChip falls through to `已停止` whenever the work is not in the queue — including a fresh `preview`-phase project that was never started. Should be silent or "未开始" in preview phase.

7. **Wizard step 3 mislabeled `改编设置`.** `ImportPage.tsx:69` steps are 选择文件/核对信息/改编设置, but step 2-index content (`ImportPage.tsx:856-920`) is插图参考 + a reference-pause toggle — no adaptation strength/density/requirements at all (backend-limited, per fidelity audit residual #3). Either rename the step to match reality (e.g. `插图与参考`) or restructure when the backend lands settings at import.

8. **`放进哪里` radio placement is detached from what it controls.** `ImportPage.tsx:489-516` — the radio group sits beside the folder picker, but it *swaps the meaning* of the picker above it (新建系列→工程文件夹 vs 加入已有系列→已有工程). In the join case the picker label/value/button all change; creators may not connect the two. Consider ordering: radio first, then the dependent picker.

9. **No empty/loading state for confirm-first scenes.** `ConfirmFirstPage.tsx:228-253` — while `production.playerChapter` loads, `(scenes ?? [])` is empty and the page shows just the section label with zero cards; no spinner/skeleton/empty text. If the call fails, `setResult({ scenes: [] })` (line 122) is indistinguishable from a chapter with no scenes.

10. **Illustration checkbox labels are dense concatenations.** `ImportPage.tsx:866-892` — `使用插图 1 · 第 1 卷 · 第 2 章 · 第 3 段` under each thumbnail; long lines wrap awkwardly in the 3-up grid. Tighten to `插图 1 · 第 2 章` (+ tooltip) as noted in leak #14.

11. **`encoding` candidates appear only after a failed first attempt with no explanation of why the user is being asked.** `ImportPage.tsx:540-570` — the fieldset appears with just the legend `原文编码`; a non-technical creator doesn't know what encoding is or why they must choose. The preview snippets do the heavy lifting, but one quiet lead-in line ("自动识别失败，请选一个能正常显示原文的编码") is exactly the warranted-exception case DESIGN.md allows.

#### Low

12. **Records drawer "gap" copy is opaque**: `部分较早的运行记录已不可用。` (`ChapterRecords.tsx`) — technically accurate but reads like data loss; it's ring-buffer eviction. Low priority copy polish.

13. **Confirm pages hide the primary action's blocker.** `ConfirmVisualPage` shows `还差 N 项未选定` in the header actions — good; but the character tabs only mark completion with a tiny `CircleCheck` and `未选定` small text; nothing lists *which* items are missing at the top. Prototype parity acceptable — low.

14. **`priorityMark`/`waitChip` 10-11px text** in production rows (`Production.module.css:459-477`) is below comfortable reading size for primary status info; the row already has strong hierarchy, consider 11px minimum consistently.

15. **Dark-theme check of stale-thumb warning stripes**: `.staleThumb` (`Production.module.css:567-588`) bakes a red diagonal "broken" stripe into the *empty* thumbnail background — visible behind every image until it loads; in dark theme the stripe uses `--color-on-error-container` which may be very light. Verify visually; consider only showing stripes when the image truly failed.

---

### Shared fixes that should live in one place (foundation task candidates)

1. **`humanizeError(error | string)` helper** (`packages/ui/src/` shared, e.g. `utils/errors.ts`) — one mapping table from backend error shapes to localized, creator-friendly sentences:
   - `[code] …` prefixed model errors (`network/auth/moderation/not_found/invalid_config/reasoning_limit/internal/cancelled`) → localized per-code messages ("网络连接中断，模型暂时不可用" etc.), stripping the bracket code;
   - scheduler errorType enums (`budget_paused`, `portrait_framing`, `matting_unavailable`, `reasoning_limit`) → localized sentences for run-record details;
   - project error codes (`invalid_document`, `unsupported_format`, `unsupported_reader`, `unsupported_database`) → localized explanations with recovery hint;
   - import/EPUB/DOCX/PDF exception messages → mapped or generic fallback;
   - generic `error.message` passthrough **only as last resort**, never for known patterns.
   Consumers: `ProductionPage` issue line, `WorkPage` issue chip/tooltip, `ChapterState` tooltip, `ChapterRecords` detail, `ImportPage` banner, `WorkProduction` error page, `ExportPackage`, `StaleAssets`.
2. **Backend contract adjustment (companion task)**: `production.chapterRecord` should stop embedding hardcoded zh-CN `message`; emit structured `status` (+ machine-readable `errorKind`) and let the UI compose localized copy. Same for the missing `draw` step records and live `running` records if the drawer is to match spec.
3. **`formatChapterLabel` / `formatVolumeLabel` helpers** — single source for `第 N 章` / `第 N 卷` (with correct half-width spacing), zero-padded index variant for row numerals, and `第 X–Y 章` ranges; replaces `chapterIndex` duplication across production/work/import and the `第{{value}}卷` vs `第 {{index}} 卷` drift in locale keys.
4. **`formatLanguage(code)` helper** — shared localized language-name table (currently private to `ImportPage.tsx:60-66`), reused by confirm-first's language pair.
5. **`formatAssetLabel(assetKey, bible?)` helper** — human names for asset keys (`ada/uniform` → `Ada · 校服`), used by StaleAssets drawer/toast and UsagePage.
6. **`formatPath` helper** — tilde-collapse home, middle-ellipsis for long paths; used by import pickers (and library elsewhere).
7. **Shared `ButtonLink` / link-button component** in the control library — replaces the four divergent `.ghost`/`.primaryLink`/`.linkButton`/`.primary` CSS reimplementations in production/work/confirm modules.
8. **Canonical `EmptyState` usage audit** — one pattern (icon + title + text + optional action) applied to confirm-first no-chapter, production/work empty chapter lists, stale drawer.

---

## Audit: `pages/editor/` + `pages/bible/` (+ editor/bible locales)

Grounding: read all 12 editor files, all 5 bible files, both locale sets in 4 languages, DESIGN.md, docs/ux.md, docs/work-format.md, format/creator contracts, and visually confirmed key leaks in `editor-light-production.png` (`背景 · room · day`, `立绘 · Ada / uniform / neutral`, raw CSS `color: #aabbff` in mark banner) and `bible-light-production.png` (`首次出场 ch0001`, `uniform`, `angry`). Prototype comparison confirms canonical display: `第 N 章`, Chinese costume/expression names, no ids anywhere.

### 1. Leaked technical detail

#### Editor

| # | Severity | Location | What is shown | Recommendation |
|---|---|---|---|---|
| L1 | high | `SceneImages.tsx:52-58`, rendered `:231-244` | Stage footer `背景 · room · day` / `立绘 · Ada / uniform / neutral` — raw English asset-id segments; inconsistent separators (`·` vs `/`) | Humanize via shared `formatAssetLabel` using location/character names + costume descriptions |
| L2 | high | `SentenceList.tsx:174-179`; `EditorPage.tsx:1292-1298`; `EditorStage.tsx:103` | Expression picks show raw ids: last segment `smile` in simple mode, full `ada/uniform/neutral` in advanced mode; stage cast badge `Ada · angry` | Thread bible expression `description`s through; fallback humanized segment |
| L3 | high | `EditorPage.tsx:1137-1141` | Mark-proposal banner prints raw CSS `<code>color: #aabbff;</code>` + `逐字/整段` | Render sample-text preview with styles applied; hide CSS behind disclosure or drop |
| L4 | med | `RewriteModal.tsx:184` | Hunk header `对白 Ada · h3` — internal counter id | Drop id; use ordinal `第 3 处` |
| L5 | med | `RewriteModal.tsx:60-66` | Raw NVS directives as `<code>`: `source p0001-p0005`, `@bg classroom/dusk` | Humanize (`原文第 1–5 段`, asset display names) or collapse behind disclosure |
| L6 | high | `EditorPanels.tsx:193-206` | History meta shows `#a3f9` line id or raw `ada/uniform/neutral`; before/after print full raw NVS lines `ada: 我……{em}不要{/em} cont #a3f9` | Reuse `parseSentenceLines`+`RichText` to strip tail/syntax; asset labels via shared helper; drop `#lineId` |
| L7 | med | `EditorPage.tsx:1449-1452` | Default instruction `按原文「p0007」调整这一场` shown in modal input | `原文第 7 段` ordinal |
| L8 | high | `SourcePanel.tsx:68`, `:31-37` | Every source paragraph prefixed `p0001 ·`; range line `原文 p0001 – p0005`. Prototype shows no ids | Drop per-paragraph id; format range `原文第 1–5 段` |
| L9 | low-med | `EditorPage.tsx:929` | Scene select falls back to raw 8-hex scene id `a3f29b0c` | Fallback `第 N 场` ordinal |
| L10 | med | `EditorPage.tsx:909-916`, `:876-878` | Chapter select falls back to raw `ch0001` when title missing | `第 N 章` ordinal or `未命名章节` |
| L11 | med | `EditorPage.tsx:1262` + all locales | Panel title `NVS 剧本` — internal format acronym in all 4 locales | Rename `剧本文本`/`脚本原文` |
| L12 | low | `JumpPoints.tsx:19-23,128` | Jump menu items `{line} · {raw NVS line with cont/#a3f9}` | Strip tail via existing parser |
| L13 | low | `SentenceList.tsx:155,558`; `EditorStage.tsx:99`; `RewriteModal.tsx:178` | Speaker fallback `?? sentence.speaker` can show raw English speaker id | Shared `speakerDisplayName` helper for consistency |
| L14 | med | `EditorPage.tsx:640` + `editor.css:196-205` | Compile diagnostics joined with `\n` but `.editor-alert` lacks `white-space: pre-wrap` → run-on single line; messages reference asset/speaker ids | Fix whitespace; humanize diagnostics |

#### Bible

| # | Severity | Location | What is shown | Recommendation |
|---|---|---|---|---|
| L15 | **high** — most pervasive leak | `BiblePage.tsx:203,992`; `BibleFields.tsx:278,418-427,560,665,748-753`; `CharacterDetail.tsx:226,287,520,530` | Raw `ch0001` in: occurrences (`ch0001 · p0003`), character list 首次出场, ChangeList chips, location/relation 首次出现/揭示章节, timeline chips, foreshadowing 埋于/回收, outfit 起始章, knows chips | Shared `formatChapterLabel(chapterId, chapterOrder)` → `第 N 章`. Page already loads `chapterOrder` but uses it only for filtering |
| L16 | high | `CharacterDetail.tsx:228,154,160,115,130-136`; `BibleFields.tsx:516-518`; `BiblePage.tsx:1177` | Raw costume/expression/variant ids: outfit name `uniform`, expression labels `angry`, lightbox title `Ada · uniform · angry`, variant chips `day`/`night` | Needs data decision: schema display names vs descriptions; fallback humanize |
| L17 | high | `CharacterDetail.tsx:564`; `BibleFields.tsx:807`; `BiblePage.tsx:1190` | Raw file paths: `<code>{ref.path}</code>` in 参考图; style-ref thumb source label and lightbox chip print paths | Drop paths entirely; show description + image only |
| L18 | med-high | `BiblePage.tsx:340,316-330`; `BibleFields.tsx:86-88` | Candidate `<Fields>` dump renders `章节: ch0003` raw; conflict diffs via `formatConflictValue` print raw chapter ids; unknown open-schema keys show raw English key names | Key-aware formatting of chapter values in `StructuredValue`/`formatConflictValue` |
| L19 | med | `BiblePage.tsx:597-605` | Volume fallback `卷 v0001`, worse `卷 joined-<uuid>` | Ordinal `第 N 卷` from `volumeIndex` |
| L20 | med | `BiblePage.tsx:197-208`; `BibleFields.tsx:982` | Occurrence rows `ch0001 · p0003`; jargon labels `跨章节定位`/`定位` | `第 N 章 · 第 M 段`; rename to `出现位置`/`原文出处` |
| L21 | low | `BibleFields.tsx:244` | Tooltip `下级同 ID 条目整条覆盖` mentions "ID" | Reword without "ID" |
| L22 | med | `BiblePage.tsx:106-109` | `title()` fallback prints raw entry ids for relations/timeline/foreshadowing in proposal cards | Synthesize per-kind titles (`from → to` names, event text, description) |

No revision hashes, token counts, or model ids are displayed on these surfaces (verified — revisions/versions are passed around but never rendered).

### 2. Style inconsistency

- **S1 (med)** — Editor empty/loading states are bespoke `<p className="editor-empty">`/`<p className="editor-muted">` (`SentenceList.tsx:529`, `EditorPage.tsx:1005,1152`) instead of the canonical `EmptyState` component used everywhere else (bible, library, production, usage).
- **S2 (low)** — Dead CSS: `.editor-banner`, `.editor-button*`, `.editor-icon-button*`, `.editor-chip` blocks (`editor.css:27-101,218-258`) have no tsx references — dead weight inviting divergence.
- **S3 (med)** — Advanced-mode toolbar uses bespoke `.editor-chip-button` (`editor.css:321-345`) — a third button style; the same mark-insertion in simple mode uses `Chip`. One convention needed.
- **S4 (low-med)** — Fractional font sizes 13.5/12.5/11.5px in `BiblePage.module.css` (~10 sites) and `editor.css` (6 sites). Project-wide issue — type scale should be tokenized.
- **S5 (low)** — Inline styles in JSX: `BibleFields.tsx:482,658,732` (the ul reset duplicated verbatim in TimelineView and ForeshadowingView), `CharacterDetail.tsx:62`.
- **S6 (med)** — ` 章` suffix hack: cutoff slider label split into `截至第` + readout + `" 章"` suffix; en locale uses a literal zero-width-space translation (`en/bible.json:2`). Locale-hostile; restructure label or slider API.
- **S7 (med)** — Status chip polarity inverted: `Chip active` = confirmed (quiet candidates need attention, not vice versa); plus timeline/glossary append a *separate* `候选` chip — two conventions for one concept on one page.
- **S8 (low)** — Candidate drawer uses `<h3>` for long agent prompt text (headings-as-copy).

### 3. UX / display problems

- **U1 (high)** — `Fields` (`BibleFields.tsx:170-194`) is a dense recursive structured-data dump of every non-handled open-schema key; nested objects become `key：value，`runs or nested sub-cards — walls of small text with raw English keys on real data. Curate per-kind; demote unknown keys behind a collapsed "其他信息" disclosure.
- **U2 (data issue, flag)** — Key colors show English model output (`black hair`/`blue eyes`) in zh UI — pipeline/prompting problem, not UI-fixable. `[INFERENCE]` on origin.
- **U3 (med)** — Occurrences disclosure inside narrow glossary table `定位` column (`BibleFields.tsx:992`) — expanded quotes blow up row heights.
- **U4 (low-med)** — Nav counts inconsistent: timeline/foreshadowing respect cutoff filter; characters/relations/locations don't.
- **U5 (med)** — `BiblePage.tsx:266` proposal status line always shows filler `待确认` (duplicating the chip); when stale the reason is plain text while 接受候选 is silently disabled — should be a warning banner explaining the disabled state.
- **U6 (low-med)** — `有原文对照`/`连播` chips on every expanded sentence card (`SentenceList.tsx:162-164`) — metadata noise; `连播` is jargon for auto-continue.
- **U7 (med)** — Save errors expose invisible machinery: `请选择带句子 ID 的文本行，保留末尾 ID` — users can't see the id in sentence mode, so the error is unactionable; reword without mentioning IDs.
- **U8 (low)** — History undo button only on first entry; no hint elsewhere.
- **U9 (low-med)** — Cutoff slider copy only explains model input, but the control also filters/dims display — users may be surprised content disappears.
- **U10 (med)** — Rewrite hunks lack positional context (no sentence ordinals) — can't tell which of several similar lines is being rewritten; use `第 N 句` ordinals once L4's `h3` is dropped.
- **U11 (low-med)** — Location/relation/style descriptions render unbounded multi-paragraph text; consider clamp + expander.
- **U12 (low)** — Glossary `操作` column exists solely for one hover-revealed icon button; mostly empty.
- **U13 (low)** — Two ask-agent affordances on one page: ghost text button on cards vs hover icon in rows.

### Shared fixes for a foundation task

1. **`formatChapterLabel(chapterId, chapterOrder?)` / `formatParagraphLabel(paragraphId)`** in one shared module — `第 N 章` / `第 M 段`, locale-keyed, digit-parse fallback. Consumers: all L15/L20 sites, editor L8/L10, history, rewrite modal. `chapterOrder` already exists in both pages.
2. **`formatAssetLabel(assetId, context)`** — one conversion of `place/variant` / `character/costume/expression` to display text (names/descriptions), consistent separators. Consumers: SceneImages footer, expression selects, stage badges, history, rewrite directives. Planner must decide the data path (thread descriptions through `editor.open` vs client-side join).
3. **Shared NVS-line humanizer** — strip `#xxxx`/`cont`/`wait` tails, render via existing `parseSentenceLines`+`RichText`; apply to history, rewrite hunks, jump menu. All primitives already exist in `sentence-lines.ts`.
4. **Error/diagnostic humanizer** — one mapping for backend/compile messages; fix `.editor-alert` newline handling; decide pass-through policy for raw `cause.message` (currently shown verbatim in both pages).
5. **Curated bible field rendering** — replace generic `Fields` dump with per-kind sections + collapsed "其他信息"; chapter-aware value formatting inside `StructuredValue`/`formatConflictValue` (needs fix 1).
6. **Product decision required**: display names for costumes/expressions/variants (schema extension vs promote `description`) — blocks the proper fix for L2/L16; ship humanizing fallback meanwhile.
7. **Locale-safe unit labeling for sliders** — replace the `" 章"` suffix key + zero-width-space hack with structured formatting.

---

## Audit: `pages/player/` + `panels/agent/` — leaked technical detail, style inconsistency, UX problems

### Summary

The two surfaces diverge from the prototype in one systematic way: **the prototype renders curated, humanized labels everywhere (tool titles like 「查看第 7 章剧本」, Chinese arg labels, no raw JSON), while production pipes backend contract shapes straight into the DOM** — snake_case tool names (`read_bible`, `spawn_agent`), English role enums as subtask titles (`writer`, `reviewer`), raw JSON argument keys (`volumeId`, `assetId`, `sceneId`), a default-expanded "原始数据" JSON dump, raw asset path-ids (`char/costume/expr`), chapter id fallbacks (`ch0003`), hunk ids (`h1`), and an English backend sentence containing a raw UUID proposal id. The player surface is cleaner but still leaks raw `chapterId` fallbacks in save/history views, exposes millisecond units in a settings slider, renders one completely unstyled button and several unstyled error `<p>`s, and its legacy-save panel uses hobbyist wording (`版本 v3`, `槽位 N`). Shared fixes belong in a foundation task: a `toolDisplayName` map, a `formatChapterLabel` helper, a humanized asset-label helper (already half-existing in `pages/editor/scene-assets.ts`), and a shared error humanizer.

---

### 1. Leaked technical detail

#### Agent panel — tool cards (`panels/agent/MessageView.tsx`)

| # | `file:line` | What is shown | Who sees | Recommendation |
|---|---|---|---|---|
| L1 | `MessageView.tsx:265` | **Raw snake_case tool name as the card title**: `part.name` rendered directly. Values are `read_bible`, `read_chapter_preview`, `read_glossary`, `read_scene`, `read_source_range`, `list_assets`, `read_chapter_manifest`, `read_task_result`, `propose_bible_change`, `propose_glossary_change`, `propose_adaptation_notes`, `propose_rewrite_scene`, `propose_redraw_image`, `propose_redo_chapter`, `propose_resynthesize_volume`, `spawn_agent` (defined in `packages/creator/src/chat/tools.ts:64-73,139` and `chat/index.ts:77-87`). Visually confirmed in `agent-light-production.png` — a card titled `read_bible` in the zh-CN UI. Prototype shows 「查看第 7 章剧本」「读取设定集」. | Every creator, every session | **Humanize.** Map each tool name to a localized display title (「读取设定集」「查看剧本」「重画图片」…). This is the single highest-impact fix on this surface. Raw name may survive behind the 详细信息 disclosure. |
| L2 | `MessageView.tsx:280` | **Raw JSON argument keys as row labels**: `inputEntries` keys rendered as-is — `volumeId`, `chapterId`, `sceneId`, `assetId`, `instruction`, `reason`, `role`, `task`, `context`, `text`, `changes`. Values are `summarize()`d, i.e. nested objects/arrays (`changes` patch arrays!) become inline `JSON.stringify` blobs — raw JSON in the primary expanded view. Prototype shows curated `{label: '章节', value: '第 7 章「沉没的回声」'}`. | Creator | **Humanize keys + values.** Per-tool arg formatter: map keys to localized labels, resolve `chapterId`→chapter title, `volumeId`→volume title, `assetId`→asset label, truncate long text. Drop machine blobs (`changes` patch arrays) from the primary view; they belong in raw data only. |
| L3 | `MessageView.tsx:331` | **Raw result keys as row labels** — same problem on the result side: whatever JSON the tool returns (`elapsed`, counts, internal flags) minus a small denylist (`checks`, `error`, image keys). Key set is unbounded and backend-defined. | Creator | Same per-tool humanization; unknown keys should not render as English labels in the primary view — move to raw data. |
| L4 | `MessageView.tsx:347-360` | **"原始数据" raw JSON dump, default-expanded** (`useState(true)` at the `rawOpen` initializer, ~line 192): `${t('参数')}\n{pretty(input)}\n${t('结果')}\n{pretty(result)}` in a mono `<pre>`. Pretty-printed multi-line raw JSON of full arguments and results — including full bible patch payloads — inside every expanded tool card. Prototype has **no raw-data section at all**. | Creator | Power users may keep this, but: default-**collapse** it (`useState(false)`), and rename from technical 「原始数据」 to the disclosure pattern (「详细信息」). Given DESIGN.md's audience, collapsing by default is the minimum; ideally it only exists for read tools, not proposal tools whose content is already on the confirm card. |
| L5 | `MessageView.tsx` (scalarResult path, ~line 336) | **Backend English sentence with raw UUID**: proposal tool results are `Proposal ${proposal.id} is awaiting the creator's decision.` (`chat/tools.ts:97-99`) where `proposal.id` is a `randomUUID()` (`chat/index.ts:427`). Rendered verbatim as the tool result text — English dev string + raw UUID in zh-CN UI. | Creator | **Remove outright.** The proposal card already conveys state; the tool result text is a model-facing message and should never reach the UI. Filter known machine-sentences, or suppress scalar results for `propose_*` tools entirely. |
| L6 | `MessageView.tsx` (spawn tool card) | **`spawn_agent` double exposure**: when the agent delegates, a tool card titled `spawn_agent` appears (args `role`/`task`/`context` — with the full task text and context dump as values), *in addition* to the separate subtask card. Its result is the subtask's entire reply as a raw string. | Creator | Hide the `spawn_agent` tool card outright — the subtask card is the human representation (matches prototype, which shows only 「核对凛在全书里的性格表现」). |
| L7 | `MessageView.tsx` — subtask title via `part.label` (`SubtaskFlatRow` ~line 420, `SubtaskCard` ~line 493) | **Raw English role enum as subtask title**: `label: role` set in `chat/index.ts:551` where role ∈ `organizer`/`writer`/`reviewer`/`artDirector`/`visualAuditor` (`chat/tools.ts:117-123`). Card title renders `writer` / `reviewer` in English; prototype shows a human task description (「核对凛在全书里的性格表现」). Also note `spawn_agent`'s tool `label: '委派子任务'` (`tools.ts:140`) exists but never reaches the UI. | Creator | Backend should send the task description as the label (the `task` argument already exists); UI should map role→localized chip (「写手」「审稿」) if the role is shown at all. Until backend changes, UI can render `task` excerpt instead of `role`. |
| L8 | `MessageView.tsx:600` | **Raw `chapterId` fallback in proposal impact line**: `actions.chapterTitles[chapterId] ?? chapterId` — when the title map misses, `ch0003`-style ids (format: `ch` + zero-padded number, `creator/src/import/txt/structure.ts:270`) render in 「影响：…」. | Creator | Humanize: never show raw id; fall back to ordinal 「第 N 章」 derived from production chapter order, or omit. |
| L9 | `MessageView.tsx:751` | **Raw asset path-id in redrawImage card**: `t('图片 {{assetId}}')` renders ids like `lin/school/smile` or `bg-harbor-night` (composite path ids, see `pages/editor/scene-assets.ts:213-217` splitting `/`). This is the primary description of *which image* gets redrawn. | Creator | **Humanize using existing helpers** — `backgroundLabel(assetId)` / `portraitLabel(assetId, speakerNames)` already exist in `pages/editor/scene-assets.ts`; promote to a shared helper. Better: show the image thumbnail itself. |
| L10 | `MessageView.tsx:667` + `MessageView.module.css:377-381` | **Hunk ids `h1`, `h2`… as checkbox labels in mono font** (`rewriteHunks` generates `h${n}` ids, `creator/src/editor/revisions/index.ts:330`). Users must check/uncheck diff hunks identified only by `h3`. | Creator | Replace with ordinal 「第 N 处改动」 or the first words of the before-text; keep `h1` out of the UI. |
| L11 | `MessageView.module.css:386-390` | **Rewrite diff content (`del`/`ins`) rendered in `--font-mono`** — novel dialogue/narration shown in monospace. Not an id leak but a tech-flavored display of literary text. | Creator | Use `--font-body`; mono is for code. (Prototype renders diff text in normal font.) |
| L12 | `AgentPanel.tsx:201,209-210` | **Context chip leaks ids**: `chapterTitles[position.chapterId] ?? position.chapterId` falls back to `ch0003`; worse, `设定集 · {{entry}}` uses `position.entryId` — a bible entry *id* (e.g. `char-lin`), never resolved to the entry's display name, so the chip always shows the raw id when attached from the bible. | Creator | Resolve entry id → entry name (needs entry name map, parallel to `chapterTitles`); never fall back to raw ids — drop the detail segment instead. |
| L13 | `session.ts` / `AgentPanel.tsx` | **Session ids *not* shown** — verified clean: session list keyed by `sessionId` but renders `session.title` only. No leak. (Noted so planner doesn't re-audit.) | — | — |
| L14 | — | **Token/usage numbers**: not present anywhere in the agent panel or player — verified clean. Usage lives in the dedicated usage page, per spec. | — | — |

#### Player (`pages/player/`)

| # | `file:line` | What is shown | Who sees | Recommendation |
|---|---|---|---|---|
| L15 | `controls/ProgressPanel.tsx:76-79` and `:178-180` | **Raw `chapterId` fallback** in history group headers and save-slot excerpts: `order === -1 ? chapterId : 第 N 章 · title` — renders `ch0003` when the chapter list lookup misses (happens for saves whose chapter was removed/reordered, exactly the legacy/migration case). | Players incl. non-technical package players | Humanize: fall back to 「未知章节」 or just omit the chapter segment, never the raw id. |
| L16 | `controls/legacy-saves/LegacySavePanel.tsx:73-86` | **Version-as-`v` and slot ids**: group header 「版本 v3」 (raw package version integer with techy `v` prefix) and rows 「槽位 12」 / 「快速存档」. Players see internal package version numbering and slot-index terminology. | Players (incl. pure players importing updated packages) | Humanize: 「版本 3」→ better, name it by what the user knows — the version they *updated from*, e.g. 「旧版本（v3）的存档」 is fine-ish, but rows should read 「存档 12」 or just the timestamp; keep 快速存档. Severity low-med: this panel only appears post-update, but it's the only migration UI a pure player ever sees, so wording matters. See UX-9. |
| L17 | `controls/PlayerControls.tsx:674-679` | **Milliseconds exposed in a user setting**: 「文字速度（毫秒 / 字）」 slider 3–153 step 1 with `ms` suffix. Players don't think in ms/char; prototype uses a unitless 文字速度 slider (5–55, inverted). | All players | Humanize: unitless 慢←→快 slider (keep mapping internal), drop the `ms` suffix. Severity med — it's a primary settings row. |
| L18 | `PlayerPage.tsx:209` | **Script compiler jargon as player-facing error**: `result.diagnostics.map(item => item.message)` — messages like 「缺少 source 行。」「在 scene 后写场景标题。」 are script-format jargon (`scene`, `source` keywords) meaningful only to someone who reads the NVS script format. Shown in the fullscreen-ish `.nl-player-error` box. Mostly creator-facing (broken project), but players of a broken *package* could see it. | Mostly creators | Humanize the container message: 「这部作品的内容有问题，无法播放」+ details behind disclosure. Severity low-med. |
| L19 | `PlayerPage.tsx:491` | **`data-mainline` JSON in DOM**: `JSON.stringify(progress.current.data.mainline)` — raw `{"chapterId":"ch0002","sceneId":"a1b2c3d4","sentenceId":…}` in a DOM attribute. **Invisible** to users; consumed by e2e tests (`tests/e2e/m3-controls.spec.ts:404+`). | Nobody visually | **Keep** (test hook) — noted so planner doesn't flag it; but don't extend the pattern. |
| L20 | `PlayerControls.tsx` chapter rows (:787) | Chapter rows show `第 {{index}} 章 · {{title}}` with ordinal — **clean**; unpublished chapters show `progressText(chapter.progress)` which is already humanized Chinese phases (写作/审稿/演出/出图) — **clean**. Noted as canonical-good. | — | — |

---

### 2. Style inconsistency

| # | `file:line` | Divergence | Canonical pattern |
|---|---|---|---|
| S1 | `MessageView.tsx:134-139` vs prototype `MessageView.tsx` (`正在思考 · Xs` / `思考了 N 秒`) | Thinking label copy differs: production 「思考过程 · 8.3s」/「思考过程 · 8 秒」/「思考过程」 vs prototype 「正在思考 · 8.3s」/「思考了 8 秒」. Copy tone inconsistent with the design reference, and the three-variant format is internally inconsistent (`{{seconds}}s` vs `{{seconds}} 秒`). | Prototype copy: active 「正在思考 · X.Xs」, done 「思考了 N 秒」. |
| S2 | `MessageView.module.css:194-197` | `.thinkingIcon[data-active]` uses `soft-pulse` infinite animation — a pulsing status indicator on an icon. DESIGN.md: **禁止圆点呼吸灯 / 脉冲圆点指示状态**; thinking/streaming should use 文字微扫光与行内竖标 only. The shimmer text already conveys activity. | Remove the pulse; rely on `ink-shimmer` label (already present). |
| S3 | `MessageView.module.css:386-390` | Rewrite diff `del`/`ins` in `--font-mono` (see L11). | `--font-body` for literary text. |
| S4 | `AgentPanel.module.css` `.send` (~line 425) `border-radius: var(--radius-md)` | Send button is a rounded-square filled button; prototype send is a filled **circle** (`--radius-full`). DESIGN.md: `--radius-full` 用于圆形图标按钮. | Match prototype: circular send button. |
| S5 | `AgentPanel.module.css` `.button,.primary` (~line 200-220) | EditBox buttons are hand-rolled local classes duplicating the Button component (`padding/border/radius/colors` re-implemented). DESIGN.md hard rule 2: 优先复用组件 — `components/Button` exists and is already used elsewhere in this same file family (`MessageView.tsx` uses `<Button size="sm" variant=…>`). | Use shared `<Button>`; delete `.button`/`.primary`. |
| S6 | `PlayerPage.tsx:581-586` | **Bare unstyled `<button>`** for 「打开本地工程」 — no class, no Button component, browser-default look in the middle of the player. | Use `<Button variant="primary">` from the component library. |
| S7 | `PlayerControls.tsx:806`, `ProgressPanel.tsx` (~line 168 `{failure && <p role="alert">}`), `LegacySavePanel.tsx` (`<p role="alert">{error}</p>`) | Error `<p>` elements with **no styling at all** — default browser text, no error color token, no layout. Compare the styled `.nl-progress-notice` used at `PlayerControls.tsx:375` for the same failure string in another spot — two different presentations of the same error, one styled one not. | One shared error-line style (token-colored, consistent placement); likely a shared component in the foundation task. |
| S8 | `controls.css` — `.nl-save-title` uses `padding: 10px 14px 0`, `.nl-save-excerpt` `2px 14px 0`, `.nl-quicksave-badge` `2px 7px`, `.nl-history-row` `12px var(--space-4)`, `.nl-player-surface[paper]` `padding: 28px 44px 46px 48px`, `.nl-end-label` `letter-spacing: 0.12em` etc. | Scattered raw px literals for spacing where `--space-*` tokens exist (DESIGN.md: 间距只用 `--space-*`; hard rule 1: values only from tokens). The `--space-px-*` tokens exist for small values but 10/12/14/28/44/46/48px literals bypass the scale. Player stage skin is partially exempt (game skin), but the overlay screens (save grid, history, settings) are app UI per DESIGN.md 「覆盖层沿用应用自身的界面风格与 Design Tokens」. | Token-audit `controls.css` overlay sections; use `--space-*`/`--space-px-*`. |
| S9 | `LegacySavePanel.module.css` `.delete { opacity: 0 }` + hover reveal | Reinvents the row-action hover pattern locally instead of the shared `.hover-row`/`.row-actions` classes used everywhere else (DESIGN.md: 行内操作 hover 才出现，`.hover-row`/`.row-actions`). Agent panel's session menu correctly uses `hover-row`/`row-actions` (`AgentPanel.tsx:68,114`). | Use shared `.hover-row`/`.row-actions`. |
| S10 | `LegacySavePanel.tsx` — rows are bare `<li>` with inline `<button>`s, no shared row/min-height treatment | Row height/typography inconsistent with the 52px list-row rule and with the save-slot rows around it (the panel is embedded inside the save/load screens). | Match list-row conventions. |
| S11 | Chapter label format fragmentation | Player: `第 {{index}} 章 · {{title}}` (`player.json`); editor: `第 {{index}} 章 {{title}}` (no separator, `editor.json`); shell queue: `{{title}} · 第 {{index}} 章` (`shell.json`); agent impact line: bare titles joined by 、. The same concept rendered 3+ ways across surfaces. | One `formatChapterLabel` helper + one locale key family (see foundation list). |
| S12 | `AgentPanel.tsx:262` `aria-label="Agent"` | English aria-label in zh-CN UI (and the panel is branded **Novelive Agent** per DESIGN.md 文案原则 — header shows only session title + sparkles icon, no product naming). | Localize aria-label; use 「Novelive Agent」 naming where the agent is named. |
| S13 | `MessageView.tsx:289-293` — `.imagePreview` | Dead placeholder: when a tool result has an image ref (`imageThumb`/`cachePath`/`imagePath`/`imageUrl`), the card renders a fixed 168px box containing **only a generic ImageIcon** — never the actual image, though `cachePath` could resolve via `window.novelive.resourceUrl` (pattern already used at `MessageView.tsx` image part). A fake thumbnail reads as broken UI. | Either render the real image (cachePath→resourceUrl) or drop the block. |

---

### 3. UX / display problems

| # | Location | Problem | Severity |
|---|---|---|---|
| U1 | `MessageView.tsx` ToolCard expanded body | **Wall of noise in the primary expanded view**: raw keys + JSON-stringified values + checks + error callout + result rows + default-open raw JSON `<pre>` — expanding one tool card can yield hundreds of lines of monospaced JSON. The useful information (what was read/decided) drowns. Prototype shows 1–3 curated rows. | high |
| U2 | `MessageView.tsx:600` + `:783` | 「影响：」 line — label with fullwidth colon glued to chapter list (`影响：第 3 章、第 5 章`); when empty it says 「不改动已生成的章节」 which reads like a caveat rather than impact. Copy inconsistent with prototype's quieter 「影响 第 5 章」 treatment. Also joins with `、` but en locale translates `、` to `, ` — fine; but zh-TW/zh-CN fine. Minor. | low |
| U3 | `AgentPanel.tsx` empty state (:354) | Empty session shows a long explanatory sentence 「可以让 Agent 改设定、调术语、重写场景或重做章节，所有改动都会先给你确认。」 — DESIGN.md: 不写说明性小字; empty states should be short. Compare `nl-history` empty 「暂无历史记录」 (good). Borderline: it's the panel's only onboarding, so keep short version like 「和 Agent 讨论修改，改动都会先给你确认」 or move to placeholder — the composer placeholder 「说说想改什么，可以直接贴图」 already half-covers it. | low |
| U4 | `PlayerControls.tsx` menu screen (:520-640) | **Duplicated action sets in one menu**: the system menu shows 存档/读档/历史记录/章节/设置 as primary rows AND a secondary section repeating 快速存档/快速读档/自动播放/跳过已读/隐藏界面 — but the quick bar *also* has all of these one click away. Menu is long for a 340px panel; two different rows for 存档 (primary) and 快速存档 (secondary) differ only subtly. Not a violation per se (mirrors prototype structure), but the menu + quickbar + overlays expose the same 6 actions in 3 places. Acceptable — flag as low for planner awareness. | low |
| U5 | `PlayerControls.tsx` 「在编辑器中打开这里」 disabled state (:572) | Disabled with only a `title` tooltip 「请先将本地工程关联到作品」 — title tooltips are unreliable/inaccessible; a pure player importing a package sees a permanently dead menu item with no explanation (they can't link projects at all — the concept is creator-only). Better: hide the item entirely when the work isn't a linked project (`editorLinked` false and not linkable), since DESIGN.md says it's the only creation-related item and it applies to 自己工程 only. | med |
| U6 | `ProgressPanel.tsx` save grid | Slots paged 6/page over 60 slots = 10 pages of pagination dots; page dots are tiny numbered buttons with no jump-to-empty-slot affordance. With few saves, user sees mostly 空存档位 cards — acceptable but the **first empty slot** isn't emphasized as the natural save target (no "save here" suggestion). Prototype identical — inherited design gap, severity low. | low |
| U7 | `ProgressPanel.tsx` slot cards | Slot card primary label is **「槽位 N」** (a technical container index) while the meaningful info (chapter · line excerpt) is the secondary excerpt. Prototype's slot card title is the save's content title, not the slot number. Players think "which moment is this", not "which container". Recommendation: title = chapter/line excerpt (or keep 槽位 N but demote to meta), time stays. | med |
| U8 | `LegacySavePanel.tsx` wording | 「这些存档无法在当前版本读取，可以保留或删除。」 — accurate but doesn't say *why* (version update) or *what happens if kept* (nothing — they're dead weight) or whether deletion is safe for the new version. Users face a keep-or-delete decision with no consequence info. Also no bulk "delete all" — 60 slots × several versions = many individual confirm clicks. And per DESIGN.md, the irreversible consequence belongs in the confirm copy: the inline 确认删除 is a bare button pair with no message at all. | med |
| U9 | `LegacySavePanel.tsx` structure | The panel renders inside both save AND load screens (`ProgressPanel` renders it whenever `legacySaves` present regardless of `view`) — in the **save** screen it's irrelevant clutter (you can't save into legacy slots). Should only appear in load screen, or as a dismissible notice. | low-med |
| U10 | `PlayerControls.tsx:668-680` settings sliders | 「文字速度（毫秒 / 字）」 mixes units into label (see L17); additionally 「瞬间显示」 is a separate toggle that just sets ms=0 — two controls for the same dimension, the toggle silently fights the slider (set slider to 5ms then toggle 瞬间显示 off → jumps to 30ms arbitrary default). Confusing state machine. Better: slider with a 瞬间 endpoint. | med |
| U11 | `useChapterWait.ts` polling + `PlayerControls.tsx:399-418` waiting card | Chapter-end waiting card shows progress words like 「制作中 · 写作」 plus a **fake fixed-position progress bar** (`waitSteps` maps phase→0.25/0.5/0.72/0.88 hard-coded in UI). Phase-based fake progress is a reasonable proxy, but the mapping is magic numbers embedded in the component; also 「等待」 chapters show text-only card without bar — inconsistent two layouts for the same card depending on phase. Acceptable design-wise; note magic numbers should live with phase definitions. | low |
| U12 | `AgentPanel.tsx` branch nav (:400-440) | Branch switcher shows `‹ 1/3 ›` — bare numbers with no indication these are *rewritten versions*; prototype identical though. 上一个分支/下一个分支 aria only. Fine — informational, no action. | low (informational) |
| U13 | `Composer.tsx` | Attach input accepts paste + picker, but no drag-drop onto panel (prototype parity — not required). Error 「图片没能加进来」 tone consistent with other 没能 messages — consistent. No action. | — |
| U14 | `PlayerPage.tsx:589` `.nl-player-error` | Error box styled with `inset: var(--space-6)` — near-fullscreen error container covering the entire player with `error-container` red. A transient error like 「无法保存阅读进度」 (a *background* failure) would blank the whole game in red — severity of presentation far exceeds severity of the error. Should be a dismissible toast/banner, reserving fullscreen for load failures. | med |
| U15 | Locale consistency | zh-TW 「跳过已读」 translated 「略過已讀」 while 「跳过中」/「跳过」 keep 跳過 — inconsistent verb within one locale (跳過 vs 略過). ja 「快存」→「Qセーブ」 keeps Latin `Q` — acceptable in ja game UI. en 「快存」→「Q.Save」 — abbreviated with periods, inconsistent with en UI copy style elsewhere (no other abbreviations); consider "Quick save". | low |
| U16 | `AgentPanel.tsx` session menu | Session list shows no recency/updatedAt — with many 新会话-titled sessions (default title 「新会话」 from `chat/index.ts:122`), indistinguishable entries. Auto-titling is backend scope; UI could at least show updatedAt. Also multiple sessions can share the identical name 「新会话」 with no disambiguation. | low-med |
| U17 | `MessageView.tsx` error tone fragmentation | Error copy mixes two voices: 「没能发出，请重试」「没能停止」 (clipped 没能-style) vs 「无法读取会话」「无法打开会话」 (无法-style) vs tool statuses 完成/失败/运行中. Within player.json same split (无法删除旧版本存档，请重试。 vs 存读档失败). Pick one voice — recommendation: 无法…请重试 for errors with actions, short labels for status. | low |

---

### Shared fixes for a foundation task

1. **`toolDisplay` registry** (`packages/ui/src/panels/agent/tool-display.ts` or shared in `lib/`): map every backend tool name → { localized title, arg key labels, per-arg value formatters (chapterId→title via chapterTitles, assetId→human label, volumeId→title) }. Required by tool cards, and reusable by the production run-record drawer (ux.md says 运行记录 shares the same display — same fix will be needed there).
2. **`formatChapterLabel(chapters, chapterId)`** helper: one canonical 「第 N 章 · 标题」/fallback-without-raw-id formatting; adopt in player ProgressPanel, PlayerControls chapter list, agent proposal impact line, agent context chip, shell queue (replacing the 3 divergent locale key families).
3. **Asset label humanizer**: promote `backgroundLabel`/`portraitLabel` out of `pages/editor/scene-assets.ts` into a shared module; use in redrawImage proposal card and tool arg formatting. Never render raw `assetId`/`chapterId`/`entryId`/`sceneId`/`hunk.id` in the UI — a shared `humanizeId`-style guard or lint rule would prevent regressions.
4. **Shared error-line component + humanizer**: one styled `<ErrorNotice>` (token colors, role=alert) replacing bare `<p role="alert">` in player surfaces; plus a policy helper that converts backend/IPC errors to user wording and strips machine detail (uuids, `Proposal … is awaiting`, compiler jargon) into a 「详细信息」 disclosure.
5. **Disclosure pattern for power users**: one shared 「详细信息」 collapsed section component (default-collapsed, mono `<pre>`) to replace the default-open 「原始数据」 — applied to tool cards and player load errors; defines what may stay (raw JSON for read tools) vs. what's removed outright (proposal machine-sentences, spawn_agent echo).
6. **Locale voice sweep**: unify 没能/无法 error voice and 跳过/略過-type verb consistency across all four `{player,agent}.json` files in one pass; add missing-resolution for bible `entryId`→name map (parallel to `chapterTitles`) feeding the context chip.
