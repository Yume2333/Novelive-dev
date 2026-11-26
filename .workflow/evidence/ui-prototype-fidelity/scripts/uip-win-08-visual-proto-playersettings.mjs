import { chromium } from '/home/shizuku/Project/Novelive-worktrees/uip-08/node_modules/playwright/index.mjs'
const OUT = new URL('../screenshots', import.meta.url).pathname
const browser = await chromium.launch({ headless: true, args: ['--force-device-scale-factor=1'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
for (const t of ['light', 'dark']) {
  await page.goto('http://localhost:5199/#/work/wugang/play', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.evaluate((v) => { document.documentElement.dataset.theme = v }, t)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  // click 设置 in the system menu
  const item = page.locator('.nl-player-menu').getByText('设置', { exact: true }).first()
  if (await item.count()) {
    await item.click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/overlay-player-settings-prototype-${t}.png`, animations: 'disabled' })
    console.log(`ok proto player settings ${t}`)
    // probe the toggle computed style
    const probe = await page.evaluate(() => {
      const sw = document.querySelector('button[role="switch"]')
      if (!sw) return null
      const cs = getComputedStyle(sw)
      return { bg: cs.backgroundColor, w: cs.width, h: cs.height }
    })
    console.log(`proto toggle ${t}:`, JSON.stringify(probe))
  } else console.log('WARN settings item missing')
}
await browser.close()
