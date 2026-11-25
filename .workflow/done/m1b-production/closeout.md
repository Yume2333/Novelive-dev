# Closeout: m1b-production

**Accepted:** 2026-11-24 by agent (omp-vibe-windows), on maintainer direction.

The maintainer has accepted the milestone and directed it be closed. The
acceptance is recorded with an explicit residual risk (below) rather than an
unqualified pass.

## Shipped

- W1: strict Electron replay of a TXT project opens and passes confirmation
  point one; volume characters and three main-visual candidates are selectable.
- W2: chapter one publishes and is playable, pausing at confirmation point two;
  placeholder chapters publish and stop/retry/run-log behave.
- W3: offline quality-regression checks and three-way style comparison are
  reproducible from redacted recordings.
- W4: a full real run of 《浮生六記》 (public domain, Wikisource vol.1) executed
  end-to-end in real Electron under `NL_REPLAY=record`: import → synthesis →
  first/second confirmations → all 4 chapters `published` and playable
  (canvas renders, dialogue advances, 0 alerts). Two real product defects found
  and fixed with offline regression tests (image-download SSRF same-network
  false-positive; replay layer dropping `init.dispatcher`), plus a redacted
  usage ledger and evidence report.

## Key decisions & plan changes

- Two product fixes landed on the run: `imageDownloadUpstream` SSRF
  `publicAddress` guard was blocking a same-network non-public CDN, and the
  replay layer's `new Request(input, init)` dropped undici `init.dispatcher`.
  See `live-run-2026-11-24.md` and `download.ts`/`replay/index.ts`/
  `m0-image.test.ts`.
- Recorded two runtime observations for follow-up (not changed): `dispatchImages`
  does not re-dispatch `queued` image tasks once a `work` is `done`; and
  `chapterImageBudget` counts never-settled abandoned reservations toward the cap.

## Residual

- **Zero-placeholder acceptance and full ch1–4 playback remain unmet.** 29 of 89
  assets are still `placeholder` (ch1–3 `chapter.placeholder=1`). The sole
  blocker is the upstream image relay returning HTTP 503 `insufficient balance`
  — an external billing condition, not a product defect; code/retry cannot fix
  it. Owner follow-up: refill the relay balance, then resume the same private
  project with the shepherd driver to redraw the remaining placeholders and
  replay ch1–4, then re-verify acceptance. See
  [live-run-2026-11-24](../../evidence/m1b/owner/live-run-2026-11-24.md) and
  [done/11](../m1b-production/11-m1b-owner-book.md).
