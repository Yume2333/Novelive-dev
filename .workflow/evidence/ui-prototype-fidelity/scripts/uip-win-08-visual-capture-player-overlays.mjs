// Production player overlay captures: system menu + save/load + settings, both themes.
// Run (background, display-isolated): env -u WAYLAND_DISPLAY -u DISPLAY NL_REPLAY=strict xvfb-run -a node uip-win-08-visual-capture-player-overlays.mjs > /tmp/uip-win-08-visual/capture-player-overlays.log 2>&1
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '../../../../node_modules/playwright/index.mjs'
import {
  require as req, REPO, OUT, original, combineCassettes, configuration, electronEnv, setTheme, waitProduction,
} from './uip-win-08-visual-lib.mjs'

const START = Date.now()
const log = (m) => console.log(`[${((Date.now() - START) / 1000).toFixed(1)}s] ${m}`)
const nav = async (page, hash) => {
  await page.evaluate((h) => { if (location.hash === h) location.hash = '/_' }, `#${hash}`)
  await page.waitForTimeout(150)
  await page.evaluate((h) => { location.hash = h }, hash)
}
async function ensureViewport(page, app) {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900) })
  await page.waitForTimeout(150)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const root = await mkdtemp(join(tmpdir(), 'uip08-player-ov-'))
  const source = join(root, 'paper.txt')
  const projects = join(root, 'projects')
  const cassette = join(root, 'cassette')
  await mkdir(projects, { recursive: true })
  await mkdir(cassette, { recursive: true })
  await writeFile(source, original)
  await combineCassettes(cassette)

  const app = await electron.launch({
    executablePath: req('electron'),
    args: [
      join(REPO, 'apps/desktop'),
      '--force-device-scale-factor=1', '--ozone-platform=x11',
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
      `--user-data-dir=${join(root, 'profile')}`,
    ],
    env: electronEnv({ NL_CASSETTE_DIR: cassette, NL_REPLAY_DELAY_MS: '10' }),
  })
  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900) })
    const page = await app.firstWindow()
    page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))
    await page.waitForSelector('text=创作端已就绪', { timeout: 30000 })
    await page.evaluate((patch) => window.novelive.call('config.update', patch).promise, configuration())

    // seed a work quickly through the wizard
    await app.evaluate(({ dialog }, answers) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [answers.shift() ?? ''] })
    }, [source, projects])
    await nav(page, '/import')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '选择原文' }).click()
    await page.getByRole('button', { name: '选择文件夹' }).click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.waitForTimeout(1300)
    const skip = page.getByRole('button', { name: '跳过核对' })
    if (await skip.count()) await skip.click()
    else await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: '开始制作' }).click()
    let workId
    for (let i = 0; i < 60; i++) {
      const lib = await page.evaluate(() => window.novelive.call('library.list', {}).promise)
      if (lib.works.length) { workId = lib.works[0].workId; break }
      await page.waitForTimeout(500)
    }
    log(`seeded workId=${workId}`)
    // confirm visuals through the real UI so chapter 1 can be produced
    await waitProduction(page, workId, (s) => s.phase === 'confirm-visual' && s.visual, 90000)
    await nav(page, `/work/${workId}/confirm/visual`)
    await page.waitForTimeout(2000)
    const visuals = page.getByRole('group', { name: '主视觉', exact: true })
    await visuals.getByRole('radio').first().check()
    for (const g of await page.getByRole('group').all()) {
      const label = await g.getAttribute('aria-label')
      if (label && label !== '主视觉') {
        const radio = g.getByRole('radio').first()
        if (await radio.count()) await radio.check().catch(() => {})
      }
    }
    await page.getByRole('button', { name: '确认并制作第一章' }).click()
    log('visual confirmed')
    // wait for chapter 1 published so the player has content
    await waitProduction(page, workId, (s) => s.phase === 'confirm-first' || s.chapters.some((c) => c.status === 'published'), 120000)
    log('chapter published')

    for (const theme of ['light', 'dark']) {
      await nav(page, `/work/${workId}/play`)
      await page.waitForTimeout(3200)
      await setTheme(page, theme)
      await page.waitForTimeout(400)
      // system menu via Escape
      await page.keyboard.press('Escape')
      await page.waitForTimeout(900)
      await ensureViewport(page, app)
      await page.screenshot({ path: `${OUT}/overlay-player-sysmenu-production-${theme}.png`, fullPage: false })
      console.log(`ok overlay-player-sysmenu-production-${theme}`)
      // save overlay from the quick bar save icon or menu item
      const menuSave = page.getByRole('button', { name: '存档', exact: true }).first()
      if (await menuSave.count()) {
        await menuSave.click().catch((e) => console.log('save click fail', e.message))
        await page.waitForTimeout(900)
        await ensureViewport(page, app)
        await page.screenshot({ path: `${OUT}/overlay-player-saveload-production-${theme}.png`, fullPage: false })
        console.log(`ok overlay-player-saveload-production-${theme}`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
      } else console.log('WARN 存档 missing in sysmenu')
      // back to story, open settings overlay
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      const menuSettings = page.getByRole('button', { name: '设置', exact: true }).first()
      if (await menuSettings.count()) {
        await menuSettings.click().catch((e) => console.log('settings click fail', e.message))
        await page.waitForTimeout(900)
        await ensureViewport(page, app)
        await page.screenshot({ path: `${OUT}/overlay-player-settings-production-${theme}.png`, fullPage: false })
        console.log(`ok overlay-player-settings-production-${theme}`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
      } else console.log('WARN 设置 missing in sysmenu')
    }
    console.log('DONE_PLAYER_OV')
  } finally {
    await app.close().catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
