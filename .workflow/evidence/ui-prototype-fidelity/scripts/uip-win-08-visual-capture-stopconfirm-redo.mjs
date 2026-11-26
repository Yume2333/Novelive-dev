// Single-shot redo: production stop ConfirmDialog, both themes.
// Boots with NL_REPLAY_DELAY_MS=300 so the pre-gate 'producing' window stretches
// long enough to open the dialog deterministically. Cancels afterwards (no stop).
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '../../../../node_modules/playwright/index.mjs'
import {
  require as req, REPO, OUT, original, combineCassettes, configuration, electronEnv, setTheme,
} from './uip-win-08-visual-lib.mjs'

const log = (m) => console.log(m)
const nav = async (page, hash) => {
  await page.evaluate((h) => { if (location.hash === h) location.hash = '/_' }, `#${hash}`)
  await page.waitForTimeout(150)
  await page.evaluate((h) => { location.hash = h }, hash)
}
async function ensureViewport(page, app) {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900) })
  await page.waitForTimeout(150)
}

const root = await mkdtemp(join(tmpdir(), 'uip08-stopconfirm-'))
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
  env: electronEnv({ NL_CASSETTE_DIR: cassette, NL_REPLAY_DELAY_MS: '300' }),
})
try {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900) })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))
  await page.waitForSelector('text=创作端已就绪', { timeout: 30000 })
  await page.evaluate((patch) => window.novelive.call('config.update', patch).promise, configuration())
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
  log('production started (slow cassette)')
  let workId
  for (let i = 0; i < 60; i++) {
    const lib = await page.evaluate(() => window.novelive.call('library.list', {}).promise)
    if (lib.works.length) { workId = lib.works[0].workId; break }
    await page.waitForTimeout(400)
  }
  if (!workId) throw new Error('no work in library')
  log(`workId=${workId}`)
  // Key fact (scheduler/chapter/index.ts phaseOf): before the visual gate there are no chapter
  // tasks, so status is 'idle' and 立即停止 never renders. The ONLY pre-failure window with
  // status==='producing' is AFTER 确认并制作第一章 while chapters are being written — with the
  // slowed cassette (NL_REPLAY_DELAY_MS=300) that window stretches to minutes.
  const { waitProduction } = await import('./uip-win-08-visual-lib.mjs')
  await waitProduction(page, workId, (s) => s.phase === 'confirm-visual' && s.visual, 120000)
  log('confirm-visual reached')
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
  // confirm directly on this page (navigating away would reset the radio selections),
  // then race to the production page and poll for 立即停止 while chapters write.
  await page.getByRole('button', { name: '确认并制作第一章' }).click()
  log('visual confirmed; ch1 producing — racing to production page')
  await nav(page, `/work/${workId}/production`)
  let stopBtn = page.getByRole('button', { name: '立即停止', exact: true }).first()
  for (let i = 0; i < 240 && !(await stopBtn.count()); i++) {
    await page.waitForTimeout(250)
    stopBtn = page.getByRole('button', { name: '立即停止', exact: true }).first()
  }
  if (!(await stopBtn.count())) throw new Error('立即停止 button never appeared')
  await setTheme(page, 'light')
  await stopBtn.click()
  await page.waitForTimeout(700)
  await ensureViewport(page, app)
  await page.screenshot({ path: `${OUT}/overlay-production-stop-confirm-production-light.png`, fullPage: false })
  console.log('ok overlay-production-stop-confirm-production-light')
  await setTheme(page, 'dark')
  await page.waitForTimeout(250)
  await ensureViewport(page, app)
  await page.screenshot({ path: `${OUT}/overlay-production-stop-confirm-production-dark.png`, fullPage: false })
  console.log('ok overlay-production-stop-confirm-production-dark')
  console.log('DONE_STOPCONFIRM')
} finally {
  await app.close().catch(() => {})
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
