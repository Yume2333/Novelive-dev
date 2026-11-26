// W4 Phase 1: capture prototype screenshots, all 14 surfaces × light/dark at 1440x900.
// Prototype vite dev server must already run at http://localhost:5199/
import { chromium } from '/home/shizuku/Project/Novelive-worktrees/uip-08/node_modules/playwright/index.mjs'
import { mkdir } from 'node:fs/promises'

const OUT = new URL('../screenshots', import.meta.url).pathname
const BASE = 'http://localhost:5199'
const THEMES = ['light', 'dark']

const START = Date.now()
const elapsed = () => `${((Date.now() - START) / 1000).toFixed(1)}s`
const log = (m) => console.log(`[${elapsed()}] ${m}`)

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    args: ['--force-device-scale-factor=1'],
  })
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))

  async function go(hash) {
    // HashRouter: force full reload so SPA state (open drawers/panels) never leaks between shots
    await page.goto('about:blank')
    await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(700)
  }
  async function theme(t) {
    await page.evaluate((v) => { document.documentElement.dataset.theme = v }, t)
    await page.waitForTimeout(280)
  }
  async function shot(name) {
    await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' })
    log(`ok ${name}`)
  }

  // Helper: capture one surface in both themes; optional prepare runs once before themes (per-theme re-run optional)
  async function capture(surface, hash, opts = {}) {
    for (const t of THEMES) {
      await go(hash)
      if (opts.prepare) await opts.prepare(page, t)
      await theme(t)
      if (opts.afterTheme) await opts.afterTheme(page, t)
      await page.waitForTimeout(200)
      await shot(`${surface}-${t}-prototype`)
      if (opts.cleanup) await opts.cleanup(page, t)
    }
  }

  // 1. welcome
  await capture('welcome', '/welcome')

  // 2. library (default route; has confirm-point chips, cards)
  await capture('library', '/')

  // 3. usage
  await capture('usage', '/usage')

  // 4. settings
  await capture('settings', '/settings')

  // 5. import — step 1 default state
  await capture('import', '/import')

  // 6. work overview — wugang is the producing project work with rich chapter data
  await capture('work', '/work/wugang')

  // 7. shell/queue — open the global production queue drawer on library
  await capture('shell-queue', '/', {
    afterTheme: async (page) => {
      const btn = page.locator('aside button', { hasText: /制作中|空闲|待确认|已停止/ }).last()
      // The GlobalStatus button: find button in sidebar bottom area
      const gs = page.locator('aside button').filter({ hasText: /全局|制作|空闲|确认/ })
      // simpler: click the global status widget — it's the button just above theme switch
      const all = page.locator('aside > div button, aside button')
      // Use a robust selector: the status button has an icon + label; try text
      const target = page.getByRole('button', { name: /制作中|空闲|待确认|已停止/ }).first()
      if (await target.count()) {
        await target.click()
        await page.waitForTimeout(800)
      } else {
        log('WARN shell: global status button not found, trying fallback')
        await page.locator('aside button').last().click().catch(() => {})
        await page.waitForTimeout(800)
      }
    },
    cleanup: async (page) => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    },
  })

  // 8. confirm-visual
  await capture('confirm-visual', '/work/dengta/confirm/visual', {
    afterTheme: async (page) => {
      await page.waitForTimeout(400)
    },
  })

  // 9. confirm-first
  await capture('confirm-first', '/work/xiari/confirm/first')

  // 10. production
  await capture('production', '/work/wugang/production')

  // 11. editor
  await capture('editor', '/work/wugang/edit', {
    afterTheme: async (page) => {
      await page.waitForTimeout(600)
    },
  })

  // 12. bible
  await capture('bible', '/work/wugang/bible')

  // 13. player — fullscreen route
  await capture('player', '/work/wugang/play', {
    afterTheme: async (page) => {
      await page.waitForTimeout(1200)
    },
  })

  // 14. agent — open chat panel on a work page
  await capture('agent', '/work/wugang', {
    afterTheme: async (page) => {
      await page.keyboard.press('Control+j')
      await page.waitForTimeout(900)
    },
    cleanup: async (page) => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    },
  })

  console.log('DONE_ALL')
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
