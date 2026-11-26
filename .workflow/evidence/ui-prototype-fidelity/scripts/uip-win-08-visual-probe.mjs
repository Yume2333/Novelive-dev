// Round-5 rework probes: computed-style/structure verification for items 1c, 4e, 7f, 7g, 7h
// in the production Electron app. Seeds a real cassette work first (same pipeline as the
// surface capture), then prints `PROBE <item>: <json>` lines.
// Run (background, display-isolated): env -u WAYLAND_DISPLAY -u DISPLAY NL_REPLAY=strict xvfb-run -a node uip-win-08-visual-probe.mjs > /tmp/uip-win-08-visual/probe.log 2>&1
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

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'uip08-probe-'))
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
    await page.waitForSelector('text=创作端已就绪', { timeout: 30000 })
    await page.evaluate((patch) => window.novelive.call('config.update', patch).promise, configuration())

    // seed a work
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

    // ============ Rework verification probes (round-5) ============
    // 1c CompactSelect chevron inside box · 4e work 更多 dropdown items ·
    // 7f player off-state Toggle track · 7g sysmenu focus/layout · 7h agent bubble/session fill.
    // Every probe prints one `PROBE <name>: <json>` line.

    // ---- 7f: player off-state Toggle track, both themes ----
    // Expected fixed: track backgroundColor = var(--color-surface-container-highest)
    // (light #e3e2e0 → rgb(227,226,224); dark #2a2a2f → rgb(42,42,47)), height 23px.
    for (const theme of ['light', 'dark']) {
      await nav(page, `/work/${workId}/play`)
      await page.waitForTimeout(3000)
      await page.evaluate((t) => { document.documentElement.dataset.theme = t }, theme)
      await page.waitForTimeout(400)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(900)
      const probe = await page.evaluate(() => {
        const all = [...document.querySelectorAll('.nl-controls-panel button[role="switch"]')]
        if (!all.length) return { error: 'no switch found in controls panel' }
        // rework 7f is about the OFF state specifically — prefer an unchecked switch
        const sw = all.find((el) => el.getAttribute('aria-checked') !== 'true') ?? all[0]
        const cs = getComputedStyle(sw)
        const r = sw.getBoundingClientRect()
        const tokenBg = getComputedStyle(document.documentElement).getPropertyValue('--color-surface-container-highest').trim()
        return {
          switchCount: all.length,
          checked: sw.getAttribute('aria-checked'),
          backgroundColor: cs.backgroundColor,
          width: cs.width,
          height: cs.height,
          rectVisible: r.width > 0 && r.height > 0,
          tokenValue: tokenBg,
          theme: document.documentElement.dataset.theme,
        }
      })
      console.log(`PROBE 7f-player-toggle-${theme}:`, JSON.stringify(probe))
      if (theme === 'light') {
        // ---- 7g (light pass, menu still open): no focus card on open; 返回作品页 isolated
        // below divider; quick rows icon-aligned ----
        const focusProbe = await page.evaluate(() => {
          const panel = document.querySelector('.nl-controls-panel')
          const ae = document.activeElement
          const inside = panel?.contains(ae) ?? false
          const focused = inside ? ae : null
          const fcs = focused ? getComputedStyle(focused) : null
          const backBtn = panel ? [...panel.querySelectorAll('button')].find((b) => /返回作品页/.test(b.textContent ?? '')) : null
          let dividerBefore = false
          if (backBtn) {
            let node = backBtn.previousElementSibling ?? backBtn.parentElement?.previousElementSibling
            while (node) {
              const cls = String(node.getAttribute?.('class') ?? '')
              if (/divider|separator|hr/i.test(cls) || node.tagName === 'HR') { dividerBefore = true; break }
              node = node.previousElementSibling
            }
          }
          const quickBar = panel?.querySelector('.nl-quick-bar')
          const quickRows = quickBar
            ? [...quickBar.querySelectorAll('button')].slice(0, 4).map((b) => {
                const icon = b.querySelector('svg')
                const br = b.getBoundingClientRect()
                const ir = icon?.getBoundingClientRect()
                return ir ? { iconOffsetTop: Math.round(ir.top - br.top), btnHeight: Math.round(br.height) } : null
              })
            : []
          return {
            focusInsidePanel: inside,
            focusedText: focused?.textContent?.trim()?.slice(0, 24) ?? null,
            focusedBoxShadow: fcs?.boxShadow ?? null,
            focusedOutline: fcs?.outline ?? null,
            focusVisibleMatches: focused?.matches(':focus-visible') ?? false,
            backButtonPresent: Boolean(backBtn),
            dividerBeforeBack: dividerBefore,
            quickRows,
          }
        })
        console.log('PROBE 7g-sysmenu-light:', JSON.stringify(focusProbe))
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
    // 7g dark-pass structural probe
    await nav(page, `/work/${workId}/play`)
    await page.waitForTimeout(3000)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
    const focusProbeDark = await page.evaluate(() => {
      const panel = document.querySelector('.nl-controls-panel')
      const ae = document.activeElement
      const inside = panel?.contains(ae) ?? false
      return { focusInsidePanel: inside, focusVisibleMatches: ae?.matches(':focus-visible') ?? false, theme: document.documentElement.dataset.theme }
    })
    console.log('PROBE 7g-sysmenu-dark:', JSON.stringify(focusProbeDark))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // ---- 1c: CompactSelect chevron inside the select box — settings 界面 + usage filter row ----
    // chevron-inside-box ⟺ wrapper right edge ≈ select right edge (rightGap within ±2px).
    for (const theme of ['light', 'dark']) {
      await nav(page, '/settings')
      await page.waitForTimeout(1800)
      await page.evaluate((t) => { document.documentElement.dataset.theme = t }, theme)
      await page.waitForTimeout(400)
      const probe = await page.evaluate(() => {
        return [...document.querySelectorAll('select')].map((sel) => {
          const r = sel.getBoundingClientRect()
          const wrap = sel.parentElement
          const wr = wrap?.getBoundingClientRect()
          return {
            text: sel.options[sel.selectedIndex]?.textContent?.slice(0, 12) ?? '',
            selectW: Math.round(r.width),
            wrapW: wr ? Math.round(wr.width) : null,
            rightGap: wr ? Math.round(wr.right - r.right) : null,
            wrapCls: wrap?.className?.slice(0, 80) ?? null,
          }
        })
      })
      console.log(`PROBE 1c-settings-selects-${theme}:`, JSON.stringify(probe))
    }
    await nav(page, '/usage')
    await page.waitForTimeout(1800)
    const usageProbe = await page.evaluate(() => {
      return [...document.querySelectorAll('select')].slice(0, 4).map((sel) => {
        const r = sel.getBoundingClientRect()
        const wrap = sel.parentElement
        const wr = wrap?.getBoundingClientRect()
        return {
          text: sel.options[sel.selectedIndex]?.textContent?.slice(0, 12) ?? '',
          selectW: Math.round(r.width),
          wrapW: wr ? Math.round(wr.width) : null,
          rightGap: wr ? Math.round(wr.right - r.right) : null,
          wrapCls: wrap?.className?.slice(0, 80) ?? null,
        }
      })
    })
    console.log('PROBE 1c-usage-selects:', JSON.stringify(usageProbe))

    // ---- 4e: work 更多 dropdown items — expected exactly [导出作品包, 作品设置] ----
    await nav(page, `/work/${workId}`)
    await page.waitForTimeout(1500)
    const moreBtn = page.getByRole('button', { name: '更多', exact: true }).first()
    if (await moreBtn.count()) {
      await moreBtn.click().catch(() => {})
      await page.waitForTimeout(600)
      const items = await page.evaluate(() =>
        [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim()).filter(Boolean),
      )
      console.log('PROBE 4e-work-dropdown-items:', JSON.stringify(items))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    } else console.log('PROBE 4e-work-dropdown-items: WARN 更多 button missing')

    // ---- 7h: agent assistant text inside bubble card; active session item has no fill ----
    await installProbeChat(app, workId)
    await page.waitForTimeout(1500)
    await nav(page, `/work/${workId}`)
    await page.waitForTimeout(1100)
    const agentBtn = page.locator('aside button').filter({ hasText: /Agent/ }).first()
    if (await agentBtn.count()) {
      await agentBtn.click().catch(() => {})
      await page.waitForTimeout(1500)
      const sessionItem = page.getByText('守塔人设定', { exact: false }).first()
      if (await sessionItem.count()) await sessionItem.click().catch(() => {})
      await page.waitForTimeout(1000)
      const probe = await page.evaluate(() => {
        const assistants = [...document.querySelectorAll('[data-role="assistant"]')]
        const a = assistants.at(-1)
        const bubble = a?.querySelector('[class*="bubble"]')
        const bcs = bubble ? getComputedStyle(bubble) : null
        const text = bubble?.textContent?.trim().slice(0, 40) ?? null
        const current = document.querySelector('[aria-current="true"]')
        const ccs = current ? getComputedStyle(current) : null
        return {
          assistantFound: Boolean(a),
          bubbleBg: bcs?.backgroundColor ?? null,
          bubbleBorder: bcs?.border ?? null,
          bubbleRadius: bcs?.borderRadius ?? null,
          bubblePadding: bcs?.padding ?? null,
          bubbleTextSample: text,
          activeSessionBg: ccs?.backgroundColor ?? null,
          activeSessionBoxShadow: ccs?.boxShadow ?? null,
          activeSessionCls: current?.className?.slice(0, 80) ?? null,
        }
      })
      console.log('PROBE 7h-agent-bubble-session:', JSON.stringify(probe))
    } else console.log('PROBE 7h-agent-bubble-session: WARN agent button missing')

    console.log('PROBE_DONE')
  } finally {
    await app.close().catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

// Minimal chat projection so the Agent panel has a session with an assistant message to probe.
async function installProbeChat(app, workId) {
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
