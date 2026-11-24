# Player and Agent prototype parity audit

Each PNG pairs the prototype (left, `prototype/src`, `#/work/wugang/play`) with the production Electron build (right, seeded minimal project, `NL_REPLAY=strict`). Both captured at 1280×800; file names record page, theme and viewport.

| Page | Prototype structure | Production result | Remaining difference |
| --- | --- | --- | --- |
| Player, soft dialogue | Full-bleed stage, bottom gradient band with accent line, speaker above text, icon-only quick bar at bottom right | Same band, 8% horizontal inset, speaker tag, icon-only quick bar with tooltips; text stays light in both themes | Real Pixi stage/background content differs from prototype mock art |
| Player, paper dialogue | Cream card inset from the edges, quick bar inside | Cream card in both themes, speaker pill, quick bar below | None structural |
| System menu | Narrow glass card: small title, 返回游戏 / 存档 / 读档 / 记录 / 章节 / 设置 / 在编辑器中打开这里, divider, exit | Same primary order and row height; real extras (快速存档, 快速读档, 自动播放, 跳过已读, 隐藏界面) kept in a smaller secondary group; 返回书库 after a divider when the route provides it | Header shows 系统菜单 instead of the work title (player route does not receive the title) |
| Save / load | Icon header with close, 3×2 thumbnail cards, numbered pagination pills | Same header, 3×2 cards, pagination pills; all 60 real slots, off-page slots hidden | Prototype has 6 mock pages, production has 10 real pages |
| History | Icon header, glass card list, speaker above line | Icon header, glass card list, speaker above line, rollback controls | Prototype groups by chapter; production history is the current session only |
| Chapters | Glass list with thumbnail, title, status, 已读 chip | Glass list with title, status, 已读 chip | No chapter thumbnails in production data |
| Settings | 680px card, filled sliders with units, switches, segmented dialogue style | 680px card, filled sliders with ms / px / %, switches, segmented dialogue style | Production keeps its extra real settings (自动播放倍率, 瞬间显示) |
| Agent drawer | Right glass drawer, sparkle badge, session header, bubbles, composer | Same geometry, badge, header actions and composer | Seeded test project has no Agent session, so the thread shows the session read error instead of messages |

`PlayerPage` stores `novelive.recentWork` as `package:${id}:${version}` for installed packages and the plain work id for projects after a chapter loads.
