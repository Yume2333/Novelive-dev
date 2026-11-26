// UI-prototype-fidelity round-5 production capture.
// Drives the real offline cassette pipeline (m1b-gate style) to seed a project
// with real production data, then captures all 14 surfaces in light+dark themes
// at 1440x900 plus overlay evidence. Zero paid API calls: NL_REPLAY=strict +
// combined m1b-gate/m1b-art cassettes, isolated HOME (see electronEnv in the lib).
//
// Requires apps/desktop/out to be built (pnpm build). Run exactly once, as a background
// job logging to /tmp/uip-win-08-visual/ (never headed on the user's desktop):
//   mkdir -p /tmp/uip-win-08-visual && env -u WAYLAND_DISPLAY -u DISPLAY NL_REPLAY=strict \
//     xvfb-run -a node .workflow/evidence/ui-prototype-fidelity/scripts/uip-win-08-visual-capture-prod.mjs \
//     > /tmp/uip-win-08-visual/capture-prod.log 2>&1
// Surfaces: <surface>-<theme>-production.png; overlays: overlay-<name>-production-<theme>.png
// (mirrors the prototype overlay naming with -prototype- swapped for -production-).
// Agent panel shots can be flaky on second open — if agent-<theme>-production.png is broken,
// redo just that theme with: node uip-win-08-visual-capture-agent.mjs <theme>
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '../../../../node_modules/playwright/index.mjs'
import {
  require as req,
  REPO,
  OUT,
  original,
  combineCassettes,
  configuration,
  electronEnv,
  setTheme,
  waitProduction,
} from './uip-win-08-visual-lib.mjs'

const START = Date.now()
const elapsed = () => `${((Date.now() - START) / 1000).toFixed(1)}s`
const log = (msg) => console.log(`[${elapsed()}] ${msg}`)

const nav = async (page, hash) => {
  await page.evaluate((h) => {
    if (location.hash === h) location.hash = '/'
  }, `#${hash}`)
  await page.waitForTimeout(150)
  await page.evaluate((h) => { location.hash = h }, hash)
}


// Ensure the window content size is exactly 1440x900 before capturing.
async function ensureViewport(page, app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  })
  await page.waitForTimeout(200)
  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }))
  if (size.w !== 1440 || size.h !== 900 || size.dpr !== 1) console.log(`WARN viewport ${size.w}x${size.h} dpr=${size.dpr}`)
}

async function capturePair(page, app, surf, hash, opts = {}) {
  for (const theme of ['light', 'dark']) {
    await nav(page, hash)
    await page.waitForTimeout(opts.settle ?? 1400)
    await setTheme(page, theme)
    if (opts.prepare) await opts.prepare(page, theme)
    await page.waitForTimeout(250)
    await ensureViewport(page, app)
    await page.screenshot({ path: `${OUT}/${surf}-${theme}-production.png`, fullPage: false })
    console.log(`ok ${surf}-${theme}-production`)
    if (opts.cleanup) await opts.cleanup(page, theme)
  }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const root = await mkdtemp(join(tmpdir(), 'uip08-prod-capture-'))
  const source = join(root, '纸船与灯火.txt')
  const projects = join(root, 'projects')
  const cassette = join(root, 'cassette')
  await mkdir(projects, { recursive: true })
  await mkdir(cassette, { recursive: true })
  await writeFile(source, original)
  await combineCassettes(cassette)

  log('launching electron')
  const app = await electron.launch({
    executablePath: req('electron'),
    args: [
      join(REPO, 'apps/desktop'),
      '--force-device-scale-factor=1',
      '--ozone-platform=x11',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      `--user-data-dir=${join(root, 'profile')}`,
    ],
    env: electronEnv({
      NL_CASSETTE_DIR: cassette,
      NL_REPLAY_DELAY_MS: '10',
    }),
  })

  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
    })
    const page = await app.firstWindow()
    page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)))
    await page.waitForSelector('text=创作端已就绪', { timeout: 30000 })
    log('creator ready')

    await page.evaluate(
      (patch) => window.novelive.call('config.update', patch).promise,
      configuration(),
    )
    log('config applied')

    // ---- Phase 1: static surfaces ----
    await capturePair(page, app, 'welcome', '/welcome')
    await capturePair(page, app, 'settings', '/settings', { settle: 1800 })
    await capturePair(page, app, 'import', '/import')
    log('static surfaces captured')

    // ---- Phase 2: import wizard ----
    await app.evaluate(
      ({ dialog }, answers) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [answers.shift() ?? ''],
        })
      },
      [source, projects],
    )
    await nav(page, '/import')
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: '选择原文' }).click()
    await page.getByRole('button', { name: '选择文件夹' }).click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.waitForTimeout(1500)
    const skip = page.getByRole('button', { name: '跳过核对' })
    if (await skip.count()) await skip.click()
    else await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.waitForTimeout(1200)
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

    // ---- Phase 2.5: production stop ConfirmDialog, captured while production is running ----
    // The 立即停止 button only renders while status==='producing', and the cassette pipeline
    // can reach the confirm-visual gate within seconds — so open the dialog ONCE and flip the
    // theme underneath it for the second shot instead of re-opening per theme.
    {
      await nav(page, `/work/${workId}/production`)
      // poll briefly for the stop button: the page needs a moment to subscribe to the snapshot
      let stopBtn = page.getByRole('button', { name: '立即停止', exact: true }).first()
      for (let i = 0; i < 20 && !(await stopBtn.count()); i++) {
        await page.waitForTimeout(250)
        stopBtn = page.getByRole('button', { name: '立即停止', exact: true }).first()
      }
      if (await stopBtn.count()) {
        await setTheme(page, 'light')
        await stopBtn.click().catch((e) => console.log('stop click fail', e.message))
        await page.waitForTimeout(700)
        await ensureViewport(page, app)
        await page.screenshot({ path: `${OUT}/overlay-production-stop-confirm-production-light.png`, fullPage: false })
        console.log('ok overlay-production-stop-confirm-production-light')
        await setTheme(page, 'dark')
        await page.waitForTimeout(250)
        await page.screenshot({ path: `${OUT}/overlay-production-stop-confirm-production-dark.png`, fullPage: false })
        console.log('ok overlay-production-stop-confirm-production-dark')
        // cancel, do NOT actually stop — the pipeline must keep running
        const cancelBtn = page.getByRole('button', { name: '取消', exact: true }).first()
        if (await cancelBtn.count()) await cancelBtn.click().catch(() => {})
        else await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
      } else console.log('WARN: 立即停止 button missing (production gate reached too fast)')
    }
    log('stop-confirm overlay captured')

    const vsnap = await waitProduction(page, workId, (s) => s.phase === 'confirm-visual' && s.visual, 90000)
    log('confirm-visual phase reached')

    // ---- Phase 3: confirm-visual + confirm-phase chrome ----
    await capturePair(page, app, 'confirm-visual', `/work/${workId}/confirm/visual`, { settle: 2200 })
    await capturePair(page, app, 'library', '/', { settle: 1600 })
    await capturePair(page, app, 'work', `/work/${workId}`, { settle: 1800 })

    // shell/queue drawer on library
    for (const theme of ['light', 'dark']) {
      await nav(page, '/')
      await page.waitForTimeout(900)
      await setTheme(page, theme)
      const btn = page.locator('button[aria-label^="全局制作状态"]').first()
      if (await btn.count()) {
        await btn.click().catch((e) => console.log('queue click fail', e.message))
        await page.waitForTimeout(1000)
      } else console.log('WARN: queue button missing')
      await ensureViewport(page, app)
      await page.screenshot({ path: `${OUT}/shell-queue-${theme}-production.png`, fullPage: false })
      console.log(`ok shell-queue-${theme}-production`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    log('confirm-phase chrome captured')

    // ---- Phase 4: confirm visual through the real UI ----
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
    log('visual confirmed; ch1 producing')

    await waitProduction(page, workId, (s) => s.phase === 'confirm-first', 120000)
    log('confirm-first reached')

    // ---- Phase 5: confirm-first + real-content surfaces ----
    await capturePair(page, app, 'confirm-first', `/work/${workId}/confirm/first`, { settle: 2200 })
    await capturePair(page, app, 'editor', `/work/${workId}/edit?chapterId=ch0001`, { settle: 3000 })
    await capturePair(page, app, 'bible', `/work/${workId}/bible`, { settle: 2800 })
    await capturePair(page, app, 'player', `/work/${workId}/play`, { settle: 3500 })
    log('real-content surfaces captured')

    // ---- Phase 6: continue -> ch2 invalid_config failure ----
    await page.evaluate((id) => window.novelive.call('production.continue', { workId: id }).promise.catch(() => {}), workId)
    await waitProduction(page, workId, (s) => s.chapters.some((c) => c.issue), 90000).catch(() => log('warn: no chapter issue appeared'))
    log('ch2 issue state reached; capturing production failure')
    await capturePair(page, app, 'production', `/work/${workId}/production`, { settle: 2000 })

    // ---- Phase 7: retry with recovered writer ----
    await page.evaluate(
      (model) => window.novelive.call('config.update', { models: { writing: { model } } }).promise,
      'gate-writer-recovered',
    )
    await page.evaluate((id) => window.novelive.call('production.retryChapter', { workId: id, chapterId: 'ch0002' }).promise.catch(() => {}), workId)
    await waitProduction(page, workId, (s) => s.phase === 'done' || s.chapters.every((c) => c.status === 'published'), 45000).catch(() => log('warn: done not reached'))
    const finalSnap = await page.evaluate((id) => window.novelive.call('production.get', { workId: id }).promise, workId)
    log(`final: phase=${finalSnap.phase} chapters=${finalSnap.chapters.map((c) => `${c.chapterId}:${c.status}${c.issue ? '!' : ''}`).join(',')}`)

    // ---- Phase 8: rich final states ----
    await capturePair(page, app, 'library', '/', { settle: 1800 })
    await capturePair(page, app, 'work', `/work/${workId}`, { settle: 2000 })
    await capturePair(page, app, 'usage', '/usage', { settle: 2000 })
    await capturePair(page, app, 'production', `/work/${workId}/production`, { settle: 2000 })
    for (const theme of ['light', 'dark']) {
      await nav(page, '/')
      await page.waitForTimeout(900)
      await setTheme(page, theme)
      const btn = page.locator('button[aria-label^="全局制作状态"]').first()
      if (await btn.count()) {
        await btn.click().catch(() => {})
        await page.waitForTimeout(1000)
      }
      await ensureViewport(page, app)
      await page.screenshot({ path: `${OUT}/shell-queue-${theme}-production.png`, fullPage: false })
      console.log(`ok shell-queue-${theme}-production (final)`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    log('rich final states captured')

    await capturePair(page, app, 'player', `/work/${workId}/play`, { settle: 3500 })

    // ---- Phase 8.5: overlay evidence (Modal/Drawer/Dropdown/ConfirmDialog) ----
    // Settings licenses Modal (glass Modal parity)
    for (const theme of ['light', 'dark']) {
      await nav(page, '/settings')
      await page.waitForTimeout(1600)
      await setTheme(page, theme)
      const lic = page.getByRole('button', { name: /第三方许可/ }).first()
      if (await lic.count()) {
        await lic.click().catch((e) => console.log('lic click fail', e.message))
        await page.waitForTimeout(900)
        await ensureViewport(page, app)
        await page.screenshot({ path: `${OUT}/overlay-settings-licenses-modal-production-${theme}.png`, fullPage: false })
        console.log(`ok overlay-settings-licenses-modal-production-${theme}`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
      } else console.log('WARN: licenses button missing')
    }
    // Work header 更多 Dropdown + 作品设置 Drawer
    for (const theme of ['light', 'dark']) {
      await nav(page, `/work/${workId}`)
      await page.waitForTimeout(1500)
      await setTheme(page, theme)
      const moreBtn = page.getByRole('button', { name: '更多', exact: true }).first()
      if (await moreBtn.count()) {
        await moreBtn.click().catch(() => {})
        await page.waitForTimeout(600)
        await ensureViewport(page, app)
        await page.screenshot({ path: `${OUT}/overlay-work-dropdown-production-${theme}.png`, fullPage: false })
        console.log(`ok overlay-work-dropdown-production-${theme}`)
        const settingsItem = page.getByRole('menuitem', { name: /作品设置/ }).first()
        if (await settingsItem.count()) {
          await settingsItem.click().catch(() => {})
          await page.waitForTimeout(900)
          await ensureViewport(page, app)
          await page.screenshot({ path: `${OUT}/overlay-work-settings-drawer-production-${theme}.png`, fullPage: false })
          console.log(`ok overlay-work-settings-drawer-production-${theme}`)
          await page.keyboard.press('Escape')
          await page.waitForTimeout(400)
        } else {
          console.log('WARN: 作品设置 menuitem missing')
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
        }
      } else console.log('WARN: work 更多 button missing')
    }
    // Production page: run-record Drawer
    for (const theme of ['light', 'dark']) {
      await nav(page, `/work/${workId}/production`)
      await page.waitForTimeout(1600)
      await setTheme(page, theme)
      const recLink = page.getByText('运行记录', { exact: false }).first()
      if (await recLink.count()) {
        await recLink.click().catch(() => {})
        await page.waitForTimeout(900)
        await ensureViewport(page, app)
        await page.screenshot({ path: `${OUT}/overlay-production-runrecord-drawer-production-${theme}.png`, fullPage: false })
        console.log(`ok overlay-production-runrecord-drawer-production-${theme}`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
      } else console.log('WARN: 运行记录 missing')
    }
    // Editor: 更多 Dropdown + history Drawer
    for (const theme of ['light', 'dark']) {
      await nav(page, `/work/${workId}/edit?chapterId=ch0001`)
      await page.waitForTimeout(2400)
      await setTheme(page, theme)
      const editorMore = page.getByRole('button', { name: '更多', exact: true }).first()
      if (await editorMore.count()) {
        await editorMore.click().catch(() => {})
        await page.waitForTimeout(600)
        await ensureViewport(page, app)
        await page.screenshot({ path: `${OUT}/overlay-editor-dropdown-production-${theme}.png`, fullPage: false })
        console.log(`ok overlay-editor-dropdown-production-${theme}`)
        const hist = page.getByRole('menuitem', { name: /修改历史/ }).first()
        if (await hist.count()) {
          await hist.click().catch(() => {})
          await page.waitForTimeout(900)
          await ensureViewport(page, app)
          await page.screenshot({ path: `${OUT}/overlay-editor-history-drawer-production-${theme}.png`, fullPage: false })
          console.log(`ok overlay-editor-history-drawer-production-${theme}`)
          await page.keyboard.press('Escape')
          await page.waitForTimeout(400)
        } else {
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
        }
      } else console.log('WARN: editor 更多 missing')
    }
    log('overlays captured')

    // ---- Phase 9: agent panel via chat projection ----
    await installChatProjection(app, workId)
    await page.waitForTimeout(1800)
    for (const theme of ['light', 'dark']) {
      await nav(page, `/work/${workId}`)
      await page.waitForTimeout(1100)
      await page.evaluate((t) => { document.documentElement.dataset.theme = t }, theme)
      await page.waitForTimeout(300)
      const agentBtn = page.locator('aside button').filter({ hasText: /Agent/ }).first()
      if (await agentBtn.count()) {
        await agentBtn.click().catch((e) => console.log('agent btn fail', e.message))
        await page.waitForTimeout(1400)
        const sessionItem = page.getByText('守塔人设定', { exact: false }).first()
        if (await sessionItem.count()) await sessionItem.click().catch(() => {})
        await page.waitForTimeout(900)
      } else console.log('WARN: agent button missing')
      await ensureViewport(page, app)
      await page.screenshot({ path: `${OUT}/agent-${theme}-production.png`, fullPage: false })
      console.log(`ok agent-${theme}-production`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    log('agent captured')

    // ---- Phase 10: library import-package Modal + toast (real .novelive exported in-session) ----
    // Export the finished work to a real package file via the share API (no UI), then drive
    // the library 导入作品包 inspect modal with the file picker stubbed to it. Importing it
    // completes with a toast — captured as the toast evidence. Runs LAST because the import
    // adds a second work to the library, which must not perturb the surface shots above.
    try {
      const snap = await page.evaluate((id) => window.novelive.call('production.get', { workId: id }).promise, workId)
      const target = snap?.exportTarget
      const packagePath = join(root, 'export', 'paper.novelive')
      await mkdir(join(root, 'export'), { recursive: true })
      if (!target?.projectRoot) {
        console.log('WARN: no exportTarget in production snapshot; skipping library-import overlay')
      } else {
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
        if (!exported?.ok) {
          console.log(`WARN: export failed: ${exported?.error?.message ?? 'unknown'}; skipping library-import overlay`)
        } else {
          log(`package exported to ${packagePath}`)
          // stub the package picker to hand back the exported file
          await app.evaluate(
            ({ dialog }, answers) => {
              dialog.showOpenDialog = async () => ({
                canceled: false,
                filePaths: [answers.shift() ?? ''],
              })
            },
            [packagePath],
          )
          for (const theme of ['light', 'dark']) {
            await nav(page, '/')
            await page.waitForTimeout(1500)
            await setTheme(page, theme)
            const importBtn = page.getByRole('button', { name: '导入作品包' }).first()
            if (await importBtn.count()) {
              await importBtn.click().catch((e) => console.log('import btn fail', e.message))
              // wait for the inspect round-trip to populate the review state
              await page.waitForTimeout(2500)
              await ensureViewport(page, app)
              await page.screenshot({ path: `${OUT}/overlay-library-import-modal-production-${theme}.png`, fullPage: false })
              console.log(`ok overlay-library-import-modal-production-${theme}`)
              if (theme === 'light') {
                // complete the import once → success toast (作品包导入完成)
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
            } else console.log('WARN: 导入作品包 button missing')
          }
        }
      }
    } catch (e) {
      console.log('WARN: library-import overlay phase failed:', String(e).slice(0, 200))
    }
    log('library-import + toast overlays captured')

    console.log('DONE_ALL')
  } finally {
    await app.close().catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

async function installChatProjection(app, workId) {
  await app.evaluate(
    ({ BrowserWindow, MessageChannelMain }, fixture) => {
      const window = BrowserWindow.getAllWindows()[0]
      const { port1, port2 } = new MessageChannelMain()
      const generation = 500
      const at = '2026-11-23T08:00:00.000Z'
      const mkMessage = (id, parentId, role, parts) => ({ id, parentId, at, kind: 'message', role, parts })
      const session = (sessionId, title) => ({ workId: fixture.workId, sessionId, title, updatedAt: at })
      const store = {
        keeper: {
          session: session('keeper', '守塔人设定'),
          headId: 'a1',
          headIds: ['a1'],
          status: 'idle',
          entries: [
            mkMessage('u1', null, 'user', [{ type: 'text', text: '守塔人的年龄写得前后不一' }]),
            mkMessage('a1', 'u1', 'assistant', [
              { type: 'reasoning', text: '先查设定集里的年龄条目。' },
              { type: 'tool', id: 'tool-1', name: 'read_bible', input: '{"entry":"守塔人","field":"年龄"}', result: '{"年龄":"五十八岁","来源":"第一章"}' },
              { type: 'subtask', id: 'sub-1', label: '核对第二章称呼', status: 'done' },
              { type: 'text', text: '设定集写的是**五十八岁**，第二章误写成六十岁。' },
            ]),
          ],
        },
      }
      port1.on('message', ({ data }) => {
        if (data.type !== 'call') return
        const base = { generation, requestId: data.requestId }
        const respond = (result) => port1.postMessage({ ...base, type: 'result', result })
        const fail = (code, message) => port1.postMessage({ ...base, type: 'error', error: { code, message } })
        const input = data.payload || {}
        switch (data.command) {
          case 'chat.list':
            respond({ sessions: Object.values(store).map((s) => s.session) })
            break
          case 'chat.get': {
            const cur = store[input.sessionId] || store.keeper
            respond({ ...cur, headId: input.headId ?? cur.headId })
            break
          }
          case 'production.get':
            respond({ workId: fixture.workId, chapterTitles: {}, phase: 'done', status: 'idle', chapters: [] })
            break
          default:
            fail('unsupported', `projection unhandled: ${data.command}`)
        }
      })
      port1.start()
      window.webContents.postMessage('novelive:port', generation, [port2])
      window.webContents.send('novelive:ready', { generation })
    },
    { workId },
  )
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
