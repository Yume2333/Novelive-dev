# Shell, library, settings, usage and welcome parity

Prototype `prototype/src` (port 5181) against production `pnpm dev` (port 5173) with local synthetic projects and seeded usage rows (167 calls; costs set on the synthetic rows for three models, one model left unpriced to show the exclusion). Files are named `<page>-<prototype|production>-<theme>-<viewport>.png`.

| Page | Matches prototype | Production difference |
| --- | --- | --- |
| Shell | Brand, global nav, current work with cover and `series · 第 N 卷`, work switcher (projects and installed packages), work nav, overlay Agent button, queue footer, theme switch, fixed 248px sidebar with long titles | An installed-package recent offers play only; there is no installed-overview host API |
| Library | Project/imported tabs, `project.directory` series groups with volume headings, covers, status and progress, header import actions, grid that fits 960px | No author line or attention/image counts, because `library.list` has no such fields |
| Settings | 760px width, label-cap sections, model cards summarized as model · API format · 同快速模型, empty slots shown as 未填模型, small 高级 toggle | — |
| Usage | 用量统计 title, 按天/按月 granularity, filter row (work/phase/model, date range, help tooltip), four KPI cards (calls, text tokens with input/output in the hint, images, reference amount), period bars, a work × phase table with prototype phase names and a per-work reference amount | Text volume is shown in tokens because usage records have no character count. The reference amount sums priced `costUsd` in USD; unpriced calls are left out and flagged, and a total with no priced calls reads 没有单价 |
| Welcome | `/welcome` outside the shell: language, create/play, real model cards; saved theme and language apply on direct launch | — |

These captures predate the integration-branch fix that makes `.page .title` 32px as in the prototype (here it renders 36px), and the Settings section-gap and Welcome input fixes made there.
