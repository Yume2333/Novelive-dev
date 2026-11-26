// Shared helpers v3 — repo-relative paths; fixed theme handling.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// scripts/ -> ui-prototype-fidelity/ -> evidence/ -> .workflow/ -> repo root
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

export const require = createRequire(path.join(REPO, 'apps/desktop/package.json'))

export const OUT = path.join(REPO, '.workflow/evidence/ui-prototype-fidelity/screenshots')
export const W = 1440
export const H = 900

export const original = [
  '第一章 纸船',
  '暮色中，一只纸船从桥下漂过。',
  '第二章 灯火',
  '桥边的灯亮了，纸船继续向前漂。',
  '',
].join('\n')

export async function combineCassettes(target) {
  const { readFile, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const gateDir = join(REPO, 'tests/fixtures/cassettes/m1b-gate')
  const artDir = join(REPO, 'tests/fixtures/cassettes/m1b-art')
  const indexes = await Promise.all(
    [gateDir, artDir].map((dir) => readFile(join(dir, 'cassette.jsonl'), 'utf8')),
  )
  await writeFile(join(target, 'cassette.jsonl'), indexes.join('\n'))
}

export const textModelBase = {
  baseUrl: 'https://relay.invalid/v1',
  apiKey: 'offline-placeholder',
  format: 'openai-completions',
  contextWindow: 12_000,
  maxOutputTokens: 4096,
  compat: 'auto',
}

export function configuration() {
  return {
    models: {
      fast: { ...textModelBase, model: 'fixture-art-fast' },
      main: { ...textModelBase, model: 'fixture-art-main', inheritFast: false },
      writing: {
        ...textModelBase,
        model: 'devin-swe-2',
        maxOutputTokens: 3000,
        inheritFast: false,
      },
      visual: { ...textModelBase, model: 'fixture-art-visual', inheritFast: false },
      image: {
        baseUrl: textModelBase.baseUrl,
        apiKey: textModelBase.apiKey,
        model: 'fixture-art-image',
        nativeMaxEdge: 1536,
        concurrency: 1,
        retries: 0,
        quality: 'medium',
        postProcess: 'off',
      },
    },
  }
}

export function electronEnv(extra = {}) {
  return {
    ...process.env,
    HOME: '/tmp/uip-win-08-visual',
    XDG_CONFIG_HOME: '/tmp/uip-win-08-visual/.config',
    XDG_DATA_HOME: '/tmp/uip-win-08-visual/.local/share',
    ELECTRON_RENDERER_URL: '',
    NL_REPLAY: 'strict',
    NL_E2E: '1',
    ...extra,
  }
}

// Direct DOM theme application — no config round-trip race.
// Also persists via config.update in the background so the app doesn't fight back.
export async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
    void window.novelive.call('config.update', { theme: t }).promise.catch(() => {})
  }, theme)
  await page.waitForTimeout(320)
}

export async function waitProduction(page, workId, pred, timeout = 30000) {
  const start = Date.now()
  for (;;) {
    const snap = await page.evaluate(
      (id) => window.novelive.call('production.get', { workId: id }).promise.catch((e) => ({ error: String(e?.message ?? e) })),
      workId,
    )
    if (snap && !snap.error && pred(snap)) return snap
    if (Date.now() - start > timeout) throw new Error(`waitProduction timeout; last=${JSON.stringify(snap).slice(0, 300)}`)
    await page.waitForTimeout(400)
  }
}
