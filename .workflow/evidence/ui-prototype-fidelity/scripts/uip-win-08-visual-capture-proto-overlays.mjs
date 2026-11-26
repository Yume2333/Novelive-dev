// Prototype overlay captures: Modal / Drawer / Dropdown / Toast evidence.
import { chromium } from '/home/shizuku/Project/Novelive-worktrees/uip-08/node_modules/playwright/index.mjs'
import { mkdir } from 'node:fs/promises'

const OUT = new URL('../screenshots', import.meta.url).pathname
const BASE = 'http://localhost:5199'
const START = Date.now()
const elapsed = () => `${((Date.now() - START) / 1000).toFixed(1)}s`
const log = (m) => console.log(`[${elapsed()}] ${m}`)

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--force-device-scale-factor=1'] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))

  async function go(hash) {
    await page.goto('about:blank')
    await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(800)
  }
  async function theme(t) {
    await page.evaluate((v) => { document.documentElement.dataset.theme = v }, t)
    await page.waitForTimeout(280)
  }
  async function shot(name) {
    await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' })
    log(`ok ${name}`)
  }

  // Library import-package Modal (prototype shows rich modal). Trigger: 导入作品包 button
  for (const t of ['light', 'dark']) {
    await go('/')
    await theme(t)
    await page.getByRole('button', { name: '导入作品包' }).click()
    await page.waitForTimeout(700)
    await shot(`overlay-library-import-modal-prototype-${t}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }

  // Work 作品设置 Drawer — open via 更多 dropdown
  for (const t of ['light', 'dark']) {
    await go('/work/wugang')
    await theme(t)
    const more = page.getByRole('button', { name: '更多', exact: true }).first()
    await more.click()
    await page.waitForTimeout(500)
    await shot(`overlay-work-dropdown-prototype-${t}`)
    // click 作品设置 menu item if exists
    const item = page.getByRole('menuitem', { name: /作品设置/ })
    if (await item.count()) {
      await item.click()
      await page.waitForTimeout(700)
      await shot(`overlay-work-settings-drawer-prototype-${t}`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    } else {
      log('WARN no 作品设置 menuitem')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
  }

  // Editor: 更多 dropdown + history drawer + rewrite modal
  for (const t of ['light', 'dark']) {
    await go('/work/wugang/edit')
    await theme(t)
    await page.waitForTimeout(500)
    const moreBtn = page.locator('button').filter({ hasText: '' }).last()
    // the editor toolbar ... dropdown: find by aria or position. Try the ellipsis icon button
    const ellipsis = page.getByRole('button', { name: '更多', exact: true }).first()
    if (await ellipsis.count()) {
      await ellipsis.click()
      await page.waitForTimeout(500)
      await shot(`overlay-editor-dropdown-prototype-${t}`)
      const hist = page.getByRole('menuitem', { name: /修改历史/ })
      if (await hist.count()) {
        await hist.click()
        await page.waitForTimeout(700)
        await shot(`overlay-editor-history-drawer-prototype-${t}`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
      }
    } else log('WARN editor 更多 not found')
  }

  // Production: run-record drawer (click a chapter row 运行记录)
  for (const t of ['light', 'dark']) {
    await go('/work/wugang/production')
    await theme(t)
    const rec = page.getByText('运行记录', { exact: false }).first()
    if (await rec.count()) {
      await rec.click()
      await page.waitForTimeout(800)
      await shot(`overlay-production-runrecord-drawer-prototype-${t}`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    } else log('WARN 运行记录 not found')
    // stop confirm dialog
    const stop = page.getByRole('button', { name: /立即停止/ }).first()
    if (await stop.count()) {
      await stop.click()
      await page.waitForTimeout(600)
      await shot(`overlay-production-stop-confirm-prototype-${t}`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
  }

  // Toast evidence: settings save triggers toast
  for (const t of ['light']) {
    await go('/settings')
    await theme(t)
    // delete preset triggers a confirm + toast; simpler: click 源代码仓库 link which toasts
    const repo = page.getByRole('button', { name: /源代码|源码|github/i }).first()
    if (await repo.count()) {
      await repo.click()
      await page.waitForTimeout(500)
      await shot(`overlay-toast-prototype-${t}`)
    } else log('WARN repo toast trigger not found')
  }

  console.log('DONE_OVERLAYS')
  await browser.close()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
