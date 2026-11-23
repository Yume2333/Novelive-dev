# M5 delivery verification

| Check | Result |
| --- | --- |
| `pnpm check` | Passed: typecheck, lint, and Vitest (836 passed, 1 skipped by the suite). |
| `NL_REPLAY=strict pnpm test:e2e --grep 'M5 share and play offline'` | Passed: a synthetic author exports, a fresh reader imports and plays after the source archive is deleted, an update migrates progress and retains an obsolete save, and an import-as-project re-exports a new identity. |
| `NL_REPLAY=strict pnpm exec playwright test --grep 'M5 share surfaces\|M5 locales'` | Passed: 3 tests covering share confirmations and four-language switching and persistence in development Electron. |
| Linux unsigned native acceptance | [Results and screenshots](../linux/README.md). |
| Windows unsigned native acceptance | Unverified: no Windows host was used in this run. NSIS install, Explorer double-click, offline playback, update, and uninstall require the Windows native runner. |
| macOS unsigned native acceptance | Unverified: no macOS host was used in this run. DMG install, Finder double-click, offline playback, ZIP output, and the unsigned manual-update prompt require the macOS native runner. |
| `NL_REPLAY=strict pnpm test:e2e --grep 'M5 full delivery'` | Unverified: no Playwright test currently matches this filter. The M5/07 replay above does not cover the full creation-to-delivery gate. |

Paid usage for this work: 0 API calls, 0 paid tokens, 0 paid images.
