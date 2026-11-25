# Player and Agent prototype parity audit

Each PNG pairs the prototype (left, `prototype/src`, `#/work/wugang/play`) with the production Electron build (right, seeded minimal project, `NL_REPLAY=strict`). Both captured at 1280×800; file names record page, theme and viewport.

| Page | Prototype structure | Production result | Remaining difference |
| --- | --- | --- | --- |
| Player, soft dialogue | Full-bleed stage, continuous transparent-to-dark gradient band with accent line about 15% down, speaker above text, icon-only quick bar at bottom right | Same continuous gradient band (the player package clips Pixi particles above `.nl-player-textbox` so weather stays out of the panel; `.nl-player-textbox::before` fades the gradient smoothly into the stage above the hairline), accent line at box top, speaker tag, icon-only quick bar with tooltips | Real Pixi stage/background content differs from prototype mock art |
| Player, paper dialogue | Near-opaque cream card with blur, inset from the edges, 124px minimum, sized to its text, speaker tab on the top edge, quick bar inside the lower edge | Same 172° cream gradient and blur, 28/44/46/48 padding and 124px minimum; the card grows with the current text page instead of reserving three lines, speaker tab at the same offset, quick bar inside the lower-right edge, stage visible around the card | None structural |
| System menu | Narrow glass card: small title, 返回游戏 / 存档 / 读档 / 记录 / 章节 / 设置 / 在编辑器中打开这里, divider, exit | Same primary order and row height; real extras (快速存档, 快速读档, 自动播放, 跳过已读, 隐藏界面) kept in a smaller secondary group; 返回书库 after a divider when the route provides it | Header shows 系统菜单 instead of the work title (player route does not receive the title) |
| Save / load | Icon header with close, 3×2 thumbnail cards, numbered pagination pills | Same header, 3×2 cards, pagination pills; all 60 real slots, off-page slots hidden | Prototype has 6 mock pages, production has 10 real pages; page buttons are in the keyboard focus loop so later pages stay reachable when page 1 is empty |
| History | Icon header, one glass card per chapter with a chapter heading, speaker above line | Icon header, history entries grouped by `snapshot.position.chapterId` into one glass card per chapter, headed 第 N 章 · title from the work chapter list (raw chapter id when the chapter is not listed), speaker above line, rollback controls | Production history holds the current session only, so the single-chapter fixture shows one group; m3-controls asserts two groups across a chapter change |
| Chapters | Glass list with thumbnail, title, status, 已读 chip | Glass list with title, status, 已读 chip | No chapter thumbnails in production data |
| Settings | 680px card, filled sliders with units, switches, segmented dialogue style | 680px card, filled sliders with ms / px / %, switches, segmented dialogue style | Production keeps its extra real settings (自动播放倍率, 瞬间显示) |
| Agent drawer | Right glass drawer, sparkle badge, session header, bubbles, tool cards, composer | Same geometry, badge, header actions, user bubble, thinking and tool cards, composer; captured from the offline m2-chat projection with a successful read_bible call | Thread content differs because it comes from the m2-chat fixture |

`PlayerPage` stores `novelive.recentWork` as `package:${id}:${version}` for installed packages and the plain work id for projects after a chapter loads.

`player-soft`, `player-paper`, `player-history`, and `agent` light/dark pairs are regenerated from the final Electron build via `tests/e2e/prototype-parity.spec.ts`.

## Soft-band vs. stage sampling (2026-11-25)

The soft dialogue band is an effectively opaque dark panel (opacity floored at `min(dialogueOpacity + 0.12, 1)` → fully opaque at the 0.9 default) with a 6vh `::before` fade into the stage above it. `m3-stage` (`面板合成` + save-stage `previewPixel`) samples raw stage pixels and the uniform top half of `.nl-player-textbox`; both assertions hold only when the veil region is flat and opaque — the earlier 11vh transparent-stop variant dimmed sampled stage pixels and bled particles into the panel sample. Both tests pass again on this build.

`m3-text`「page clip boundary … ruby-inflated lines」fails with `sawInflatedLine === false` **identically on the `novelive-finish/integration` baseline** (same fixture, same display). The sentence does cover a page boundary but no fully-visible inside line exceeds `lineHeight + 1` in this environment's font metrics (Noto renders the ruby-inflated base line within tolerance) — a pre-existing environment-dependent gap in the fixture, not a regression of the player changes.
