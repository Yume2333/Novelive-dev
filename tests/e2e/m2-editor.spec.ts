import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test'
import sharp from 'sharp'
import { build } from 'vite'
import { Project } from '../../packages/creator/src/project'
import { projectFiles } from '../../packages/format/src/model'
import {
	playerRef,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const evidence = '.workflow/evidence/m2-editor'
const firstScene =
	'scene 空屋\nsource p0001\n: 第一句。 #0001\n: 第二句。 #0002\n'
const secondScene = 'scene 门外\nsource p0002\n: 门外的风。 #0003\n'

async function editAndPreview(page: Page, secondLine = 4) {
	await expect(
		page.getByRole('heading', { name: '编辑器', exact: true }),
	).toBeVisible()
	await expect(page.getByRole('textbox', { name: 'NVS 剧本' })).toContainText(
		'第一句。',
	)
	await page.getByRole('button', { name: '原文对照' }).click()
	const source = page.getByRole('button', { name: 'p0002 · 门外原文。' })
	await source.click()
	await expect(page.getByRole('textbox', { name: 'NVS 剧本' })).toContainText(
		'门外的风。',
	)
	await expect(source).toHaveAttribute('aria-pressed', 'true')
	await page.getByLabel('场景', { exact: true }).selectOption('0')
	await expect(
		page.getByRole('button', { name: 'p0001 · 空屋原文。' }),
	).toHaveAttribute('aria-pressed', 'true')
	await page
		.getByLabel('快捷位置', { exact: true })
		.selectOption(String(secondLine))
	await expect(
		page.getByText(`当前行 ${secondLine}`, { exact: true }),
	).toBeVisible()
	const editor = page.getByRole('textbox', { name: 'NVS 剧本' })
	await editor.press('Home')
	await editor.press('ArrowRight')
	await editor.press('ArrowRight')
	await page.keyboard.insertText('改过的')
	await page.getByRole('button', { name: '保存当前句' }).click()
	await expect(page.getByRole('button', { name: '保存当前句' })).toBeDisabled()
	await expect(
		page.getByRole('button', { name: '撤销', exact: true }),
	).toBeEnabled()
	await page.getByRole('button', { name: '从当前句预览' }).click()
	await expect(page.locator('.nl-player-text')).toHaveText('改过的第二句。')
	await page.getByRole('button', { name: '撤销', exact: true }).click()
	await expect(editor).not.toContainText('改过的')
	await page
		.getByLabel('快捷位置', { exact: true })
		.selectOption(String(secondLine))
	await page.getByRole('button', { name: '从当前句预览' }).click()
	await expect(page.locator('.nl-player-text')).toHaveText('第二句。')
	await mkdir(evidence, { recursive: true })
}

test('M2 editor preview locates source and current line, edits, undoes and previews a fixed project', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m2-editor-'))
	try {
		const root = join(directory, 'project')
		const profile = join(directory, 'profile')
		const png = await sharp({
			create: { width: 32, height: 32, channels: 3, background: '#203060' },
		})
			.png()
			.toBuffer()
		await seedPlayerProject(root, png, png)
		{
			using project = await Project.open(root)
			await project.write(projectFiles.chapter(playerRef), {
				formatVersion: 1,
				chapterId: playerRef.chapterId,
				title: '固定编辑章',
				paragraphIds: ['p0001', 'p0002'],
				sceneIds: ['aaaabbbb', 'ccccdddd'],
				cg: [],
			})
			await project.writeFile(
				projectFiles.chapterText(playerRef.chapterId),
				'空屋原文。\n\n门外原文。',
			)
			await project.writeFile(
				projectFiles.scene(playerRef, 'aaaabbbb'),
				firstScene.replace('source p0001\n', 'source p0001\n@bg room/dusk\n'),
			)
			await project.writeFile(
				projectFiles.scene(playerRef, 'ccccdddd'),
				secondScene.replace('source p0002\n', 'source p0002\n@bg future/day\n'),
			)
		}
		await mkdir(join(profile, 'projects'), { recursive: true })
		await writeFile(join(profile, 'projects', playerWorkId), root)
		const app = await electron.launch({
			executablePath: require('electron'),
			args: ['apps/desktop', `--user-data-dir=${profile}`],
			env: {
				...process.env,
				NL_E2E: '1',
				NL_REPLAY: 'strict',
				ELECTRON_RENDERER_URL: '',
			},
		})
		try {
			const page = await app.firstWindow()
			await expect(page.getByText('创作端已就绪')).toBeAttached()
			await page.evaluate(({ workId, chapterId }) => {
				window.location.hash = `/work/${workId}/edit?chapterId=${chapterId}`
			}, playerRef)
			await editAndPreview(page, 5)
			await expect
				.poll(async () => {
					const { data, info } = await sharp(
						await page.locator('canvas').screenshot(),
					)
						.raw()
						.toBuffer({ resolveWithObject: true })
					const offset =
						(Math.floor(info.height * 0.1) * info.width +
							Math.floor(info.width * 0.1)) *
						info.channels
					return Array.from(data.subarray(offset, offset + 3))
				})
				.toEqual([32, 48, 96])
			await page.screenshot({ path: `${evidence}/05-editor-preview.png` })
			const opened = await page.evaluate(
				({ workId, chapterId }) =>
					window.novelive.call('editor.open', { workId, chapterId }).promise,
				playerRef,
			)
			expect(
				opened.registry.entries.find((entry) => entry.id === 'room/dusk')?.path,
			).toMatch(/^editor\/[a-f0-9]{64}\.png$/)
			expect(
				opened.registry.entries.find((entry) => entry.id === 'future/day')
					?.path,
			).toMatch(/^editor\/unavailable\/[a-f0-9]{64}\.png$/)
			const saved = await page.evaluate(
				({ opened, workId }) =>
					window.novelive.call('editor.saveRules', {
						workId,
						target: { scope: 'work' },
						expectedRevision: opened.settingsRevision,
						previous: opened.settings.rules,
						next: ['保留原文'],
					}).promise,
				{ opened, workId: playerWorkId },
			)
			expect(saved.rules).toEqual(['保留原文'])
			await page.evaluate(
				({ editorId, workId, chapterId }) =>
					window.novelive.call('editor.close', { editorId, workId, chapterId })
						.promise,
				{ ...playerRef, editorId: opened.editorId },
			)
			const history = await page.evaluate(
				(input) => window.novelive.call('editor.history', input).promise,
				{ workId: playerWorkId },
			)
			expect(history.entries.map((entry) => entry.origin)).toEqual([
				'creator',
				'undo',
				'creator',
			])
			expect(history.entries.map((entry) => entry.kind)).toEqual([
				'rules',
				'text',
				'text',
			])
			await page.evaluate(() => {
				window.location.hash = '/'
			})
			await expect(
				page.getByRole('heading', { name: '编辑器', exact: true }),
			).toHaveCount(0)
			await page.evaluate(({ workId, chapterId }) => {
				window.location.hash = `/work/${workId}/edit?chapterId=${chapterId}`
			}, playerRef)
			await expect(
				page.getByRole('textbox', { name: 'NVS 剧本' }),
			).toContainText('第二句。')
			await expect(
				page.getByRole('button', { name: '撤销', exact: true }),
			).toBeDisabled()
			await page.getByLabel('场景', { exact: true }).selectOption('1')
			await page.getByRole('button', { name: '从当前句预览' }).click()
			await expect(page.getByRole('alert')).toHaveText('无法加载舞台素材')
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test.describe('contract-render', () => {
	let fixtureJs = ''
	let fixtureCss = ''
	test.beforeAll(async () => {
		const editor = fileURLToPath(
			new URL(
				'../../packages/ui/src/pages/editor/EditorPage.tsx',
				import.meta.url,
			),
		)
		const contract = fileURLToPath(
			new URL('../../packages/creator/src/contract/index.ts', import.meta.url),
		)
		const model = fileURLToPath(
			new URL('../../packages/format/src/model/index.ts', import.meta.url),
		)
		const tokens = fileURLToPath(
			new URL('../../packages/ui/src/styles/tokens.css', import.meta.url),
		)
		const shell = fileURLToPath(
			new URL('../../packages/ui/src/styles/shell.css', import.meta.url),
		)
		const scrollbar = fileURLToPath(
			new URL(
				'../../packages/ui/src/components/ScrollArea.tsx',
				import.meta.url,
			),
		)
		const result = await build({
			configFile: false,
			logLevel: 'silent',
			define: { 'process.env.NODE_ENV': JSON.stringify('production') },
			plugins: [
				{
					name: 'editor-contract-fixture',
					resolveId: (id) =>
						id.endsWith('virtual:editor-fixture')
							? '\0editor-fixture'
							: undefined,
					load: (id) =>
						id === '\0editor-fixture'
							? `
		import React from 'react';
		import {createRoot} from 'react-dom/client';
		import {MemoryRouter, Routes, Route} from 'react-router-dom';
		import {compile} from '@earendil-works/pi-schema';
		import {EditorPage} from ${JSON.stringify(editor)};
		import {commands} from ${JSON.stringify(contract)};
		import {defaultWorkSettings} from ${JSON.stringify(model)};
		import ${JSON.stringify(tokens)};
		import ${JSON.stringify(shell)};
		import '@fontsource/noto-sans-sc/chinese-simplified-400.css';
		import {ScrollArea} from ${JSON.stringify(scrollbar)};
		const workId = ${JSON.stringify(playerWorkId)};
		let chapter = {workId, chapterId:'ch1', revision:'r1', title:'固定编辑章', paragraphs:[{id:'p0001',text:'空屋原文。'},{id:'p0002',text:'门外原文。'}], scenes:[{sceneId:'aaaabbbb',sourceIds:['p0001'],nvs:${JSON.stringify(firstScene)}},{sceneId:'ccccdddd',sourceIds:['p0002'],nvs:${JSON.stringify(secondScene)}}], markSuggestions:[{id:'mark1',name:'glow',css:'color: var(--color-primary)',perChar:false},{id:'mark2',name:'shade',css:'opacity: 0.5',perChar:true}]};
		if (window.fixtureMode === 'empty') chapter.scenes = [];
		if (window.fixtureMode === 'crlf') chapter.scenes.forEach(scene => scene.nvs = scene.nvs.replaceAll(${JSON.stringify('\n')}, ${JSON.stringify('\r\n')}));
		let history = [], revision = 1;
		window.fixtureCalls = [];
		window.novelive = {call(command, input) {
			window.fixtureCalls.push({command,input});
			const promise = Promise.resolve().then(() => {
				if (!compile(commands[command].input).check(input)) throw Error('fixture input schema: ' + command);
				if (window.fixtureMode === 'failure' || window.fixtureMode === 'stale' && command === 'editor.editLine') throw Error('版本已改变');
				let result;
				if (command === 'editor.open') { history=[]; result={editorId:'opening1',chapter,registry:{formatVersion:1,entries:[]},speakerNames:{},settings:defaultWorkSettings(),settingsRevision:'s1'}; }
				else if (command === 'editor.close') result={closed:true};
				else if (command === 'editor.editLine') { history.push(structuredClone(chapter)); chapter=structuredClone(chapter); chapter.scenes.find(s=>s.sceneId===input.sceneId).nvs=chapter.scenes.find(s=>s.sceneId===input.sceneId).nvs.replace(input.edit.previous,input.edit.next); chapter.revision='r'+(++revision); result=chapter; }
				else if (command === 'editor.undo') { chapter=history.pop(); chapter.revision='r'+(++revision); result=chapter; }
				else if (command === 'editor.resolveMark') { chapter={...chapter,revision:'r'+(++revision),markSuggestions:chapter.markSuggestions.filter(mark=>mark.id!==input.suggestionId)}; result=chapter; }
				else if (command === 'editor.rewriteScene') result={workId,chapterId:'ch1',sceneId:input.sceneId,expectedRevision:input.expectedRevision,proposalId:'rewrite1',hunks:[{id:'h1',afterLineId:null,before:[': 第一句。 #0001'],after:[': 重写第一句。 #0001']},{id:'h2',afterLineId:'0001',before:[': 第二句。 #0002'],after:[': 重写第二句。 #0002']}]};
				else if (command === 'editor.applyRewrite') { chapter=structuredClone(chapter); for(const h of input.hunkIds) chapter.scenes[0].nvs=chapter.scenes[0].nvs.replace(h==='h1'?'第一句。':'第二句。',h==='h1'?'重写第一句。':'重写第二句。'); chapter.revision='r'+(++revision); result=chapter; }
				else throw Error('unhandled fixture command '+command);
				if (!compile(commands[command].output).check(result)) throw Error('fixture output schema: '+command);
				return result;
			}); return {promise,cancel(){}};
		},resourceUrl:path=>path};
		const root=document.createElement('div');root.id='root';document.body.append(root);
		createRoot(root).render(React.createElement(ScrollArea,{style:{height:'100%'}},React.createElement(MemoryRouter,{initialEntries:['/work/'+workId+'/edit?chapterId=ch1']},React.createElement(Routes,null,React.createElement(Route,{path:'/work/:id/edit',element:React.createElement(EditorPage)})))));
	`
							: undefined,
				},
			],
			build: {
				write: false,
				lib: {
					entry: 'virtual:editor-fixture',
					name: 'editorFixture',
					formats: ['iife'],
				},
			},
		})
		const bundle = Array.isArray(result) ? result[0] : result
		if (!bundle || !('output' in bundle))
			throw new Error('Missing editor fixture bundle')
		fixtureJs = bundle.output
			.filter((item) => item.type === 'chunk')
			.map((item) => item.code)
			.join('\n')
		fixtureCss = bundle.output
			.flatMap((item) =>
				item.type === 'asset' && item.fileName.endsWith('.css')
					? [String(item.source)]
					: [],
			)
			.join('\n')
	})

	for (const mode of ['normal', 'empty', 'failure', 'stale', 'crlf']) {
		test(`M2 editor contract fixture ${mode}`, async () => {
			const profile = await mkdtemp(
				join(tmpdir(), 'novelive-editor-component-'),
			)
			const app = await electron.launch({
				executablePath: require('electron'),
				args: ['apps/desktop', `--user-data-dir=${profile}`],
				env: { ...process.env, NL_REPLAY: 'strict', ELECTRON_RENDERER_URL: '' },
			})
			try {
				const [page] = await Promise.all([
					app.waitForEvent('window'),
					app.evaluate(({ BrowserWindow }) => {
						const window = new BrowserWindow({ width: 1400, height: 1440 })
						void window.loadURL('about:blank')
					}),
				])
				await page.evaluate((mode) => {
					Object.assign(window, { fixtureMode: mode })
				}, mode)
				page.on('pageerror', (error) =>
					console.error('Editor fixture:', error.message),
				)
				await page.addStyleTag({ content: fixtureCss })
				await page.addScriptTag({ content: fixtureJs })
				if (mode === 'empty') {
					await expect(page.getByText('本章还没有剧本')).toBeVisible()
					await expect(
						page.getByRole('button', { name: '从当前句预览' }),
					).toBeDisabled()
					return
				}
				if (mode === 'failure') {
					await expect(page.getByRole('alert')).toHaveText('版本已改变')
					return
				}
				if (mode === 'crlf') {
					await expect(
						page.getByRole('textbox', { name: 'NVS 剧本' }),
					).toContainText('第一句。')
					await expect(
						page.getByRole('button', { name: '保存当前句' }),
					).toBeDisabled()
					await editAndPreview(page)
					return
				}
				if (mode === 'stale') {
					const editor = page.getByRole('textbox', { name: 'NVS 剧本' })
					await expect(editor).toContainText('第一句。')
					await page.getByLabel('快捷位置', { exact: true }).selectOption('3')
					await editor.press('End')
					await editor.press('Home')
					await editor.press('ArrowRight')
					await editor.press('ArrowRight')
					await page.keyboard.insertText('草稿')
					await page.getByRole('button', { name: '保存当前句' }).click()
					await expect(page.getByRole('alert')).toHaveText('版本已改变')
					await expect(editor).toContainText('草稿')
					return
				}
				await editAndPreview(page)
				await page
					.getByRole('region', { name: '新标记提议' })
					.filter({ hasText: 'glow' })
					.getByRole('button', { name: '拒绝标记' })
					.click()
				await page.getByRole('button', { name: '接受标记' }).click()
				await expect(
					page.getByRole('region', { name: '新标记提议' }),
				).toHaveCount(0)
				await page.getByLabel('快捷位置', { exact: true }).selectOption('3')
				await page.getByRole('button', { name: '强调', exact: true }).click()
				await expect(
					page.getByRole('textbox', { name: 'NVS 剧本' }),
				).toContainText('{em}{/em}')
				await page.getByRole('button', { name: '撤销', exact: true }).click()
				await page.getByRole('textbox', { name: '重写要求' }).fill('只改第一句')
				await page
					.getByRole('button', { name: '重写场景', exact: true })
					.click()
				await page.getByRole('checkbox', { name: /h2/ }).uncheck()
				await page.getByRole('checkbox', { name: /h1/ }).uncheck()
				await expect(
					page.getByRole('button', { name: '应用勾选差异' }),
				).toBeDisabled()
				await page.getByRole('checkbox', { name: /h1/ }).check()
				await page.getByRole('button', { name: '应用勾选差异' }).click()
				await expect(
					page.getByRole('textbox', { name: 'NVS 剧本' }),
				).toContainText('重写第一句。')
				await expect(
					page.getByRole('textbox', { name: 'NVS 剧本' }),
				).not.toContainText('重写第二句。')
				await page.evaluate(async () => {
					await document.fonts.ready
					document.querySelector('[data-scroll-viewport]')?.scrollTo(0, 0)
				})
				await page.screenshot({
					path: `${evidence}/05-editor-contract-fixture.png`,
				})
			} finally {
				await app.close()
				await rm(profile, { recursive: true, force: true })
			}
		})
	}
})
