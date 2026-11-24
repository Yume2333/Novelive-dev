# Shell, library, settings, usage and welcome parity

Prototype `prototype/src` (port 5181) against production `pnpm dev` (port 5173) with local synthetic projects and seeded usage rows. Files are named `<page>-<prototype|production>-<theme>-<viewport>.png`.

| Page | Matches prototype | Production difference |
| --- | --- | --- |
| Shell | Brand, global nav, current work with cover and `series · 第 N 卷`, work switcher (projects and installed packages), work nav, overlay Agent button, queue footer, theme switch, fixed 248px sidebar with long titles | An installed-package recent offers play only; there is no installed-overview host API |
| Library | Project/imported tabs, `project.directory` series groups with volume headings, covers, status and progress, header import actions, grid that fits 960px | No author line or attention/image counts, because `library.list` has no such fields |
| Settings | 760px width, label-cap sections, model cards summarized as model · API format · 同快速模型, empty slots shown as 未填模型, small 高级 toggle | — |
| Usage | 用量统计 title, granularity select (按天/按月), work/phase/model filters with titles, date range, help tooltip, stat cards, period bars, work × phase table, detail list | Totals are tokens and image counts; the prototype's reference cost card has no data source |
| Welcome | `/welcome` outside the shell: language, create/play, real model cards; saved theme and language apply on direct launch | — |
