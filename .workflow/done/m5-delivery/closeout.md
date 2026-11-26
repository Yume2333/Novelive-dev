# Closeout: m5-delivery

**Accepted:** 2026-11-26 by user (remaining physical Windows/macOS checks waived)

## Shipped

- **W1.** Export from single work, volume and series; import and play offline in a separate data directory with no model config. `M5 share and play offline` passed on dev Electron (`7664e1a`), the Linux AppImage, and the Windows/macOS CI installs (`1ac35cb`).
- **W2.** Two exports of one work (work version 1 → 2): format rejection, update prompt, trash, same-ID save and read-state migration, orphan save retention, and import-as-project re-export with a new ID. Covered by `M5 share and play offline` and `M5 full delivery`.
- **W3.** Unsigned local installers for three platforms: Linux AppImage built and run natively on Fedora 45; Windows NSIS and macOS DMG/ZIP built and run headless on native CI runners (run `45556159242`). Update policy per platform, license files, and zh-TW/en/ja UI verified. Receipts in [`evidence/m5/`](../../evidence/m5/closeout/README.md).
- Re-check on `7e0c8a6`: `NL_REPLAY=strict pnpm check` exit 0 (Vitest 1218 passed, 3 skipped); `M5 full delivery` 1 passed (17.4s, headless isolated HOME/XDG).

## Key decisions & plan changes

- 2026-11-26, user: physical Windows Explorer / macOS Finder double-click, newer-version NSIS `quitAndInstall`, and running a macOS `.zip` after extraction are waived and treated as passed on the CI evidence.
- 2026-11-26, user: brand icon redesign, code signing / notarization, and the human translation spot-check are dropped. Builds stay unsigned with the current icon and machine translations.
- The formal repository is still undecided. Auto-update goes ahead as separate work after M5.

## Waived checks & skipped reviews

- `07`, `09`, `10`, `11`: `Check waived` (physical desktop items) and `Review: skipped`, both on the owner's direction, 2026-11-26.

## Remaining debt & follow-ups

- Auto-update with a real release source (depends on the repository decision).
