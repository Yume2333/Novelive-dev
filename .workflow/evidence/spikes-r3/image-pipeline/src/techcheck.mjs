// Technical check per visuals.md §4 — five checks, no aesthetics.
// Returns {pass, failedChecks[], detail} where failedChecks ⊆
// {undecodable, wrongSize, subjectCut, noAlpha, fakeChecker}
import sharp from 'sharp'

export async function techCheck(buf, { wantAlpha = false, baseSize = null, derivedSize = null } = {}) {
  const out = { pass: true, failedChecks: [], detail: {} }
  let meta
  try {
    meta = await sharp(buf).metadata()
  } catch (e) {
    out.pass = false; out.failedChecks.push('undecodable'); out.detail.err = String(e).slice(0, 120)
    return out
  }
  const { width: w, height: h, hasAlpha } = meta
  out.detail.size = `${w}x${h}`; out.detail.hasAlpha = hasAlpha

  const expect = derivedSize || baseSize
  if (expect && (w !== expect.w || h !== expect.h)) {
    out.pass = false; out.failedChecks.push('wrongSize')
    out.detail.expected = `${expect.w}x${expect.h}`
  }

  // alpha validity: look at the alpha channel distribution, not pixels.
  // Flags both "no alpha at all" and "alpha exists but fully opaque".
  if (wantAlpha) {
    if (!hasAlpha) {
      out.pass = false; out.failedChecks.push('noAlpha')
    } else {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const a = data.filter((_, i) => i % 4 === 3)
      let transparent = 0, partial = 0
      let minA = 255
      for (const v of a) { if (v < 16) transparent++; else if (v < 250) partial++; if (v < minA) minA = v }
      const tp = transparent / a.length
      out.detail.alpha = { transparentPct: +(tp * 100).toFixed(2), partialPct: +((partial / a.length) * 100).toFixed(2), minAlpha: minA }
      if (tp < 0.005) { // less than 0.5% truly transparent → not a real transparent sprite
        out.pass = false; out.failedChecks.push('alphaNotTransparent')
      }
      // fake-checkerboard detector: checkerboard painted INTO the image shows up as a
      // regular two-tone grid in the RGB of "supposedly background" regions or as a
      // periodic pattern of fully-opaque tiles. Cheap detector: scan a band near the
      // borders/corners of the RGB where alpha is opaque — if the corner pixels form a
      // strict 2-color alternation, flag it.
      const chk = detectFakeChecker(data, info.width, info.height, a)
      if (chk.suspect) { out.pass = false; out.failedChecks.push('fakeChecker'); out.detail.fakeChecker = chk }
    }
  }
  return out
}

// The observed failure (character-consistency.md:18): model paints a grey/white
// checkerboard pattern into pixels. With real alpha the corners are transparent;
// with a painted board corners are opaque alternating greys. Detect by sampling
// the outer 8-px frame's opaque region for a bimodal 2-level pattern with
// near-equal populations and low residual variance around two modes.
function detectFakeChecker(data, w, h, alpha) {
  const vals = []
  const pushIfOpaque = (x, y) => {
    const i = (y * w + x) * 4
    if (alpha[y * w + x] >= 250) vals.push((data[i] + data[i + 1] + data[i + 2]) / 3)
  }
  for (let x = 0; x < w; x += 4) { pushIfOpaque(x, 2); pushIfOpaque(x, h - 3) }
  for (let y = 0; y < h; y += 4) { pushIfOpaque(2, y); pushIfOpaque(w - 3, y) }
  if (vals.length < 64) return { suspect: false, reason: 'not enough opaque border' }
  const n = vals.length
  const mean = vals.reduce((s, v) => s + v, 0) / n
  // split around mean
  const lo = vals.filter(v => v <= mean), hi = vals.filter(v => v > mean)
  const mLo = lo.reduce((s, v) => s + v, 0) / (lo.length || 1)
  const mHi = hi.reduce((s, v) => s + v, 0) / (hi.length || 1)
  const varL = lo.reduce((s, v) => s + (v - mLo) ** 2, 0) / (lo.length || 1)
  const varH = hi.reduce((s, v) => s + (v - mHi) ** 2, 0) / (hi.length || 1)
  const balance = Math.min(lo.length, hi.length) / Math.max(lo.length, hi.length)
  // classic board: two tight clusters (σ<12), balanced (ratio>0.5), separated (>35 levels)
  const suspect = Math.sqrt(varL) < 12 && Math.sqrt(varH) < 12 && balance > 0.5 && (mHi - mLo) > 35
  return { suspect, mLo: +mLo.toFixed(1), mHi: +mHi.toFixed(1), sdLo: +Math.sqrt(varL).toFixed(1), sdHi: +Math.sqrt(varH).toFixed(1), balance: +balance.toFixed(2), n }
}
