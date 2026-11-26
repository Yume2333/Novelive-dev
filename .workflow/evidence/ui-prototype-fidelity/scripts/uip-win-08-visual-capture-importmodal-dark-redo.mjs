// Redo: dark-theme library import modal only. Fresh boot; modal captured on FIRST open
// (no prior import in this session, so inspect shows the clean new-work review).
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '../../../../node_modules/playwright/index.mjs'
import {
  require as req, REPO, OUT, original, combineCassettes, configuration, electronEnv, setTheme, waitProduction,
} from './uip-win-08-visual-lib.mjs'

const nav = async (page, hash) => {
  await page.evaluate((h) => { if (location.hash === h) location.hash = '/_' }, `#${hash}`)
  await page.waitForTimeout(150)
  await page.evaluate((h) => { location.hash = h }, hash)
}
async function ensureViewport(page, app) {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900) })
  await page.waitForTimeout(150)
}

const root = await mkdtemp(join(tmpdir(), 'uip08-importmodal-dark-'))
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
    await page.waitForTimeout(400)
  }
  if (!workId) throw new Error('no work')
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
  await waitProduction(page, workId, (s) => s.chapters.some((c) => c.status === 'published'), 120000)
  console.log('chapter published')
  const snap = await page.evaluate((id) => window.novelive.call('production.get', { workId: id }).promise, workId)
  const target = snap?.exportTarget
  if (!target?.projectRoot) throw new Error('no exportTarget')
  const packagePath = join(root, 'export', 'paper.novelive')
  await mkdir(join(root, 'export'), { recursive: true })
  const exported = await page.evaluate(
    ({ target, workId, destination }) =>
      window.novelive.host.share.call({
        operation: 'export',
        projectRoot: target.projectRoot,
        scope: { level: 'work', volumeId: target.volumeId, workId },
        includeSource: false,
        destination,
      }),
    { target, workId, destination: packagePath },
  )
  if (!exported?.ok) throw new Error(`export failed: ${exported?.error?.message ?? 'unknown'}`)
  await app.evaluate(
    ({ dialog }, answers) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [answers.shift() ?? ''] })
    },
    [packagePath],
  )
  await nav(page, '/')
  await page.waitForTimeout(1500)
  await setTheme(page, 'dark')
  const importBtn = page.getByRole('button', { name: '导入作品包' }).first()
  await importBtn.click()
  // wait for the inspect round-trip: the review banner or works list inside the dialog
  await page.waitForTimeout(3000)
  const modalOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))
  console.log(`modal-open-probe=${modalOpen}`)
  await ensureViewport(page, app)
  await page.screenshot({ path: `${OUT}/overlay-library-import-modal-production-dark.png`, fullPage: false })
  console.log('ok overlay-library-import-modal-production-dark')
  console.log('DONE_IMPORTMODAL_DARK')
} finally {
  await app.close().catch(() => {})
  await rm(root, { recursive: true, force: true }).catch(() => {})
  setTimeout(() => process.exit(0), 3000).unref()
}
