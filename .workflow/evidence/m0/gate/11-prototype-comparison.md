# W5 — app and prototype, Chromium at 1280 × 900

| Surface | App | Prototype |
| --- | --- | --- |
| Empty library | [App](11-w5-app-library.png) | [Prototype empty-library preview](11-w5-prototype-library.png) |
| Settings | [App](11-w5-app-settings.png) | [Prototype](11-w5-prototype-settings.png) |
| Image settings | [App](11-w5-app-image-fields.png) | [Prototype](11-w5-prototype-image-fields.png) |
| Appearance settings | [App](11-w5-app-appearance.png) | [Prototype](11-w5-prototype-appearance.png) |

The M0 sidebar omits recent works and global production state. The library
omits the project/import tabs and the new, import, and onboarding actions.
Settings offers only Simplified Chinese, and omits M1b advanced settings and
image save format. The prototype brand artwork and seeded models are placeholders;
M0 uses the wordmark and requires the user to configure models.

The gate restored the library's glass empty-state card and aligned Settings
title and model-card spacing, the full-width image API key, and the prototype
grouping of quality, native size, concurrency, retries, and post-processing.
The app retains real Save, Cancel, and result/error states; the prototype
controls mock state. No native scrollbars appeared in the comparisons.

## Independent W5 acceptance

**Accepted:** 2026-11-22 by the lead reviewer (independent W5 review).

The lead reviewer compared the original screenshots at `2e9d6ab`, identified
the following differences, and directed closeout after fixing them and
recapturing the comparison. The fixes use the prototype source and DESIGN.md.

| Finding | Resolution |
| --- | --- |
| Model card controls showed the chevron first, and the test button was too large. | The header now shows status → compact test button → chevron. `cef1078` |
| Image fields lacked the native-size hint and differed in divider, option labels and API key typography. | Added “超出部分由本地放大”, matched the post-processing separator and option labels, and styled “API KEY” from the prototype field label. `746f354` |
| The sidebar used a monitor for system theme. | Uses the prototype’s half-circle Contrast icon. `bef451a` |
| The library lacked the prototype empty-state heading. | Uses “书库还是空的”, retaining “还没有作品” without advertising unavailable actions. `32cfbd8` |
| The Appearance section needed confirmation against the prototype. | Verified “简体中文” is the only language; matched row spacing, inset divider, compact selectors and theme icon and labels. `6dc984d` |

The follow-up check verified the visible control order, pointer expansion via
the chevron, the native-size hint, the language and theme options, and all
four same-viewport screenshot pairs.
