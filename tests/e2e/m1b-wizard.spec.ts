import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	test,
} from '@playwright/test'
import sharp from 'sharp'

const require = createRequire(
	new URL('../../apps/desktop/package.json', import.meta.url),
)
const fixture = new URL(
	'../fixtures/source/txt/multivolume.txt',
	import.meta.url,
)

async function launch(profile: string) {
	const app = await electron.launch({
		executablePath: require('electron'),
		args: ['apps/desktop', `--user-data-dir=${profile}`],
		env: { ...process.env, ELECTRON_RENDERER_URL: '', NL_REPLAY: 'strict' },
	})
	const page = await app.firstWindow()
	await expect(page).toHaveURL(/^file:.*\/out\/renderer\/index\.html$/)
	await expect(page.getByText('创作端已就绪')).toBeAttached()
	return { app, page }
}

/** Answers the next native open dialogs in order, as if the creator picked them. */
async function answerDialogs(app: ElectronApplication, answers: string[][]) {
	await app.evaluate(({ dialog }, queue) => {
		dialog.showOpenDialog = async () => {
			const filePaths = queue.shift() ?? []
			return { canceled: !filePaths.length, filePaths }
		}
	}, answers)
}

async function closeWizard(app: ElectronApplication) {
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({
			response: 1,
			checkboxChecked: false,
		})
	})
	await app.close()
}

const json = async (root: string, path: string) =>
	JSON.parse(await readFile(join(root, path), 'utf8'))

async function chapters(root: string) {
	const series = await json(root, 'series.json')
	const result: string[][] = []
	for (const volumeId of series.volumeIds) {
		const volume = await json(root, `volumes/${volumeId}/volume.json`)
		const dir = `volumes/${volumeId}/works/${volume.workIds[0]}`
		const work = await json(root, `${dir}/work.json`)
		for (const chapterId of work.chapterIds) {
			const chapter = await json(
				root,
				`${dir}/chapters/${chapterId}/chapter.json`,
			)
			result.push([
				volume.title,
				chapter.title,
				await readFile(join(root, `source/chapters/${chapterId}.txt`), 'utf8'),
			])
		}
	}
	return { series, result }
}

let workspace: string
test.beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'novelive-wizard-e2e-'))
})
test.afterEach(async () => {
	await rm(workspace, { recursive: true, force: true })
})

test('M1b TXT wizard reviews findings, revises chapter divisions and keeps a reference image', async () => {
	const source = join(workspace, 'books', '风.txt')
	const image = join(workspace, 'books', 'ref.png')
	const projects = join(workspace, 'projects')
	await mkdir(join(workspace, 'books'))
	await mkdir(projects)
	await writeFile(
		source,
		`${await readFile(fixture, 'utf8')}\nChapter One 余波\n`,
	)
	await sharp({
		create: { width: 8, height: 8, channels: 3, background: '#406080' },
	})
		.png()
		.toFile(image)
	const { app, page } = await launch(join(workspace, 'profile'))
	try {
		await answerDialogs(app, [[source], [image], [projects]])
		await page.getByRole('link', { name: '导入原文' }).click()
		await expect(page.getByRole('heading', { name: '新建工程' })).toBeVisible()
		await page.getByRole('button', { name: '选择原文' }).click()
		await expect(page.getByLabel('作品名')).toHaveValue('风')
		await page.getByRole('button', { name: '添加图片' }).click()
		await expect(page.getByText('ref.png')).toBeVisible()
		await page.getByRole('button', { name: '选择文件夹' }).click()
		await expect(page.getByText(projects, { exact: true })).toBeVisible()
		await page.getByRole('button', { name: '下一步', exact: true }).click()

		await expect(
			page.locator('[aria-current="step"]', { hasText: '核对信息' }),
		).toBeVisible()
		const root = join(projects, '风')
		expect(await readFile(join(root, 'source/original.txt'))).toEqual(
			await readFile(source),
		)
		const imported = await chapters(root)
		expect(imported.series.volumeIds).toEqual(['v0001', 'v0002', 'v0003'])
		expect(imported.result).toContainEqual([
			'第一卷 风起',
			'序章',
			'她推开了门。\n',
		])
		const findings = page.getByRole('region', { name: '整理建议' })
		await expect(findings).toContainText('第一章 再会')
		await expect(findings).toContainText(
			'疑似标题，保留在正文待核对：Chapter One 余波',
		)
		const chapter = (n: number) =>
			page.getByRole('group', { name: `第 ${n} 章` })
		await expect(page.getByRole('group', { name: /^第 \d+ 章$/ })).toHaveCount(
			6,
		)
		await chapter(2).getByRole('textbox').fill('序章 门')
		await chapter(3).getByRole('button', { name: '拆分' }).click()
		await expect(chapter(4).getByRole('textbox')).toHaveValue(
			'第一章 归来（续）',
		)
		await expect(
			chapter(6).getByRole('button', { name: '并入上一章' }),
		).toBeDisabled()
		await chapter(7).getByRole('button', { name: '并入上一章' }).click()
		await page
			.getByRole('region', { name: '第 2 卷' })
			.getByRole('button', { name: '并入上一卷' })
			.click()
		await chapter(2).getByRole('button', { name: '从此分卷' }).click()
		await page.getByLabel('第 1 卷标题').fill('上卷')
		await page.getByLabel('第 2 卷标题').fill('风起')
		await expect(page.getByLabel('第 3 卷标题')).toHaveValue('第二卷 风止')
		await page.getByRole('button', { name: '下一步', exact: true }).click()
		await page
			.getByRole('checkbox', { name: /参考图时也停在角色设定/ })
			.uncheck()
		await page.getByRole('button', { name: '开始制作' }).click()
		await expect(page).toHaveURL(/#\/work\//)

		const { series, result } = await chapters(root)
		expect(series.volumeIds).toEqual(['v0001', 'v0002', 'v0003'])
		expect(result).toEqual([
			['上卷', '前言', '合成前言：风从山上来。\n'],
			['风起', '序章 门', '她推开了门。\n'],
			['风起', '第一章 归来', '她说：“我们回家。”\n'],
			['风起', '第一章 归来（续）', '风吹过山林。\n'],
			['风起', '第二章 远方', '他站在门外。\n'],
			[
				'第二卷 风止',
				'楔子',
				'天亮了。\n\n他们再次相见。\n\nChapter One 余波\n',
			],
		])
		const report = await json(root, 'source/import-report.json')
		expect(report.references).toEqual(['source/references/01.png'])
		expect(report.check.chapterFindings).toEqual([
			{
				chapterId: 'ch0006',
				note: 'fuzzy-heading: 疑似标题，保留在正文待核对 (line 27: Chapter One 余波)',
			},
		])
		expect(await readFile(join(root, 'source/references/01.png'))).toEqual(
			await readFile(image),
		)
		const volume = await json(root, 'volumes/v0003/volume.json')
		const work = await json(
			root,
			`volumes/v0003/works/${volume.workIds[0]}/work.json`,
		)
		expect(work.settings.confirmWithReferences).toBe(false)
	} finally {
		await closeWizard(app)
	}
})

test('M1b TXT wizard asks for an ambiguous encoding and can skip review', async () => {
	const source = join(workspace, '中.txt')
	await writeFile(source, Buffer.from('a4a4', 'hex'))
	const { app, page } = await launch(join(workspace, 'profile'))
	try {
		await answerDialogs(app, [[source], [workspace]])
		await page.getByRole('link', { name: '导入原文' }).click()
		await page.getByRole('button', { name: '选择原文' }).click()
		await page.getByRole('button', { name: '选择文件夹' }).click()
		await page.getByRole('button', { name: '下一步', exact: true }).click()
		const encodings = page.getByRole('group', { name: '原文编码' })
		await expect(encodings.getByRole('radio')).not.toHaveCount(0)
		await expect(
			page.getByRole('button', { name: '下一步', exact: true }),
		).toBeDisabled()
		expect(await readdir(workspace)).not.toContain('中')
		await encodings.getByRole('radio', { name: /Big5/ }).check()
		await page.getByRole('button', { name: '下一步', exact: true }).click()
		await expect(
			page.locator('[aria-current="step"]', { hasText: '核对信息' }),
		).toBeVisible()
		await expect(page.getByText('Big5（繁体）')).toBeVisible()
		await page.getByRole('button', { name: '跳过核对' }).click()
		await page.getByRole('button', { name: '开始制作' }).click()
		await expect(page).toHaveURL(/#\/work\//)
		const root = join(workspace, '中')
		const { result } = await chapters(root)
		expect(result).toEqual([['第一卷', '正文', '中\n']])
		const report = await json(root, 'source/import-report.json')
		expect(report.encoding).toBe('big5')
		expect(report.layout).toBeUndefined()
	} finally {
		await closeWizard(app)
	}
})
