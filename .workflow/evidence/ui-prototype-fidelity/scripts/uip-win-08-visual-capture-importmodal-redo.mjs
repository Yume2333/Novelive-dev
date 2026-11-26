// Single-purpose redo: library 导入作品包 inspect Modal (both themes) + import-success toast (light).
// The main capture's phase 10 reads production.get AFTER the chat projection has replaced the
// host port — the projection's canned answer has no exportTarget, so the export never happened.
// This boot installs no projection, so the snapshot is real. Pipeline runs to completion first.
//
// Run (background, display-isolated):
//   env -u WAYLAND_DISPLAY -u DISPLAY ELECTRON_OZONE_PLATFORM_HINT=x11 XDG_SESSION_TYPE=x11 \
//     NL_REPLAY=strict xvfb-run -a node uip-win-08-visual-capture-importmodal-redo.mjs \
//     > /tmp/uip-win-08-visual/capture-importmodal-redo.log 2>&1
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '../../../../node_modules/playwright/index.mjs'
import {
  require as req, REPO, OUT, original, combineCassettes, configuration, electronEnv, setTheme, waitProduction,
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

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'uip08-importmodal-'))
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
    log('production started')
    let workId
    for (let i = 0; i < 60; i++) {
      const lib = await page.evaluate(() => window.novelive.call('library.list', {}).promise)
      if (lib.works.length) { workId = lib.works[0].workId; break }
      await page.waitForTimeout(500)
    }
    if (!workId) throw new Error('no work in library')
    log(`workId=${workId}`)

    // run the pipeline to the first gate and through it, so the work has real published content
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
    await waitProduction(page, workId, (s) => s.phase === 'confirm-first' || s.chapters.some((c) => c.status === 'published'), 120000)
    log('chapter published')

    // real snapshot (no chat projection in this boot) → exportTarget with projectRoot
    const snap = await page.evaluate((id) => window.novelive.call('production.get', { workId: id }).promise, workId)
    const target = snap?.exportTarget
    if (!target?.projectRoot) throw new Error(`no exportTarget in snapshot: ${JSON.stringify(snap).slice(0, 200)}`)
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
    log('package exported')
    await app.evaluate(
      ({ dialog }, answers) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [answers.shift() ?? ''] })
      },
      [packagePath],
    )
    for (const theme of ['light', 'dark']) {
      await nav(page, '/')
      await page.waitForTimeout(1500)
      await setTheme(page, theme)
      const importBtn = page.getByRole('button', { name: '导入作品包' }).first()
      if (!(await importBtn.count())) { console.log('WARN: 导入作品包 button missing'); continue }
      await importBtn.click().catch((e) => console.log('import btn fail', e.message))
      await page.waitForTimeout(2500)
      await ensureViewport(page, app)
      await page.screenshot({ path: `${OUT}/overlay-library-import-modal-production-${theme}.png`, fullPage: false })
      console.log(`ok overlay-library-import-modal-production-${theme}`)
      if (theme === 'light') {
        const confirmImport = page.getByRole('dialog').getByRole('button', { name: /^(导入|确认导入与更新)$/ }).first()
        if (await confirmImport.count()) {
          await confirmImport.click().catch(() => {})
          await page.waitForTimeout(2000)
          await ensureViewport(page, app)
          await page.screenshot({ path: `${OUT}/overlay-toast-production-${theme}.png`, fullPage: false })
          console.log(`ok overlay-toast-production-${theme}`)
        } else console.log('WARN: import confirm button missing; no toast capture')
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
    console.log('DONE_IMPORTMODAL')
  } finally {
    await app.close().catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
