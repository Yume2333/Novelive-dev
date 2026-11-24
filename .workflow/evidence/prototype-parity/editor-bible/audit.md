# Editor and bible prototype parity audit

Prototype reference: `prototype/` served by Vite, routes `#/work/wugang/edit` and `#/work/wugang/bible`.
Result: real Electron entry point (built app launched by the strict-replay E2E fixtures), captured at the same viewport and theme as each reference.

Files are named `<prototype|result>-<page>-<theme>-<width>x<height>.png`.

| Page / state | Viewports | Matches | Residual difference |
| --- | --- | --- | --- |
| Editor | 1080×693, 1440×1000, light + dark | Page header with eyebrow, chapter picker › scene picker subtitle; square icon toolbar (source, preview, undo) and one primary "Agent 重写本场景" action; stage frame capped at `max(440px, (100vh − 620px) · 16/9)` with the real 960×540 preview scaled inside; stacked below 1060px, two columns at 1060px, script/source column beside the stage | Redo and the "more" menu are not shown because the editor has no redo stack or extra commands. Save/discard stay as secondary text controls in the subtitle row. The replay fixture's 32×32 background does not fill the stage, which is the player's real output. The chapter picker lists published chapters from `production.get`; the fixture chapter is unpublished, so it shows as a single entry. |
| Bible: characters | 1440×1000, light + dark | 196px category rail with counts, 240px character list, one detail card for the selected character, candidates chip opening a separate side panel (closed by default) | Prototype-only sections (props, skeleton, whole-book preview, expression grids, chapter cutoff slider) are not shown because production data has no fields for them. Volume switcher replaces the cutoff slider. |
| Bible: glossary | 1440×1000, light + dark | Table with 原文写法 / 作品里的写法 / 注音 / 类别 / 备注 columns built from real glossary entries, plus a 定位 column for occurrences; candidate status shown as a chip | The prototype's helper line above the table is omitted. The occurrence column is extra and keeps the cross-chapter location feature. |

Responsive: bible switches to an icon-only rail below 960px and stacks below 720px. Both are covered by CSS but not captured here.
