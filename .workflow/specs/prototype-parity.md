# Prototype parity
**Status:** done
**Accepted:** 2026-11-24 by agent (omp-vibe-windows)
**Priority:** high
**Integration branch:** devin/1795518395-prototype-parity-integration

## What this is for
The production UI has diverged from the repository prototype. Restore its page structure, spacing, hierarchy, visual controls and overlay behavior without replacing working backend flows with mock data.

## What it does
Match all reference surfaces in `prototype/src/`: shell, welcome, library, usage, settings, import, overview, production, visual confirmation, first-chapter confirmation, editor, bible, player and Agent panel. Real content, empty states and capability limitations may differ; document each material difference.

## How it is built
Four independent frontend areas preserve current contracts and events. Shared primitives and global styles are owned by the shell area. Authoring, editor/bible and player/Agent use scoped styles and existing APIs. Integration checks the combined result and collects matched-viewport reference/result screenshots. No paid API calls.

## How we will know it works
- **W1.** `NL_REPLAY=strict pnpm check` passes on the integrated branch.
- **W2.** `pnpm build` and offline Electron entry-point checks pass; existing authoring and playback routes remain reachable.
- **W3.** Compare the actual rendered pages directly against `prototype/src/` at matching viewports in both themes, with screenshots and a per-page parity matrix explaining remaining capability differences.
- **W4.** Inspect shell navigation, Agent overlay, editor preview, and player menus on the real Electron path; no native scrollbar or content-obscuring layout regression.
