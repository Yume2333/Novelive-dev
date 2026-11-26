// Dedicated agent-panel recapture: fresh boot per theme to avoid the second-open flakiness.
// Seeds a real work, installs the chat projection, opens the panel, captures one theme per boot.
// Run (background, display-isolated): env -u WAYLAND_DISPLAY -u DISPLAY NL_REPLAY=strict xvfb-run -a node uip-win-08-visual-capture-agent.mjs <light|dark> > /tmp/uip-win-08-visual/capture-agent-<theme>.log 2>&1
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '../../../../node_modules/playwright/index.mjs'
import {
  require as req, REPO, OUT, original, combineCassettes, configuration, electronEnv, setTheme, waitProduction,
} from './uip-win-08-visual-lib.mjs'

const START = Date.now()
const log = (m) => console.log(`[${((Date.now()-START)/1000).toFixed(1)}s] ${m}`)
const nav = async (page, hash) => {
  await page.evaluate((h) => { if (location.hash === h) location.hash = '/_' }, `#${hash}`)
  await page.waitForTimeout(150)
  await page.evaluate((h) => { location.hash = h }, hash)
}
async function ensureViewport(page, app) {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900) })
  await page.waitForTimeout(150)
}

async function boot(root, cassette) {
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
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900) })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))
  await page.waitForSelector('text=创作端已就绪', { timeout: 30000 })
  return { app, page }
}

async function seedWork(page, app, root, projects) {
  const source = join(root, 'paper.txt')
  await writeFile(source, original)
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
    await page.waitForTimeout(500)
  }
  return workId
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const theme = process.argv[2] || 'dark'
  const root = await mkdtemp(join(tmpdir(), 'uip08-agent-'))
  const projects = join(root, 'projects')
  const cassette = join(root, 'cassette')
  await mkdir(projects, { recursive: true })
  await mkdir(cassette, { recursive: true })
  await combineCassettes(cassette)

  const { app, page } = await boot(root, cassette)
  try {
    const workId = await seedWork(page, app, root, projects)
    log(`seeded workId=${workId}`)
    // Install the chat projection in the SAME live instance (replaces the host port).
    await installChatProjection(app, workId)
    await page.waitForTimeout(1500)
    await nav(page, `/work/${workId}`)
    await page.waitForTimeout(1100)
    await setTheme(page, theme)
    await ensureViewport(page, app)
    const agentBtn = page.locator('aside button').filter({ hasText: /Agent/ }).first()
    if (await agentBtn.count()) {
      await agentBtn.click().catch((e) => console.log('agent btn fail', e.message))
      await page.waitForTimeout(1500)
      const sessionItem = page.getByText('守塔人设定', { exact: false }).first()
      if (await sessionItem.count()) await sessionItem.click().catch(() => {})
      await page.waitForTimeout(1000)
    } else console.log('WARN agent button missing')
    const open = await page.evaluate(() => Boolean(document.querySelector('aside[aria-label="Agent"]')))
    log(`panel-open-probe=${open}`)
    await ensureViewport(page, app)
    await page.screenshot({ path: `${OUT}/agent-${theme}-production.png`, fullPage: false })
    console.log(`ok agent-${theme}-production`)
  } finally { await app.close().catch(() => {}) }
  console.log('DONE_AGENT')
  await rm(root, { recursive: true, force: true }).catch(() => {})
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
          headId: 'a1', headIds: ['a1'], status: 'idle',
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
          case 'chat.list': respond({ sessions: Object.values(store).map((s) => s.session) }); break
          case 'chat.get': { const cur = store[input.sessionId] || store.keeper; respond({ ...cur, headId: input.headId ?? cur.headId }); break }
          case 'production.get': respond({ workId: fixture.workId, chapterTitles: {}, phase: 'done', status: 'idle', chapters: [] }); break
          default: fail('unsupported', `projection unhandled: ${data.command}`)
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
