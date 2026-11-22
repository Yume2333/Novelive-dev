import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
	importTxtProject,
	reviseTxtProject,
	validateLayout,
} from '../../packages/creator/src/import/wizard'
import {
	mergeChapter,
	mergeVolume,
	renameChapter,
	splitChapter,
	startVolume,
} from '../../packages/ui/src/pages/import/layout'

const fixture = new URL(
	'../fixtures/source/txt/multivolume.txt',
	import.meta.url,
)
const temporary: string[] = []
afterEach(async () => {
	for (const directory of temporary.splice(0))
		await rm(directory, { recursive: true, force: true })
})
async function workspace() {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-wizard-'))
	temporary.push(directory)
	return directory
}
async function tree(root: string, dir = ''): Promise<Record<string, string>> {
	const files: Record<string, string> = {}
	for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
		const path = dir ? `${dir}/${entry.name}` : entry.name
		if (entry.isDirectory()) Object.assign(files, await tree(root, path))
		else if (!/^project\.db|import-report\.json$/.test(entry.name))
			files[path] = await readFile(join(root, path), 'utf8')
	}
	return files
}
const json = async (root: string, path: string) =>
	JSON.parse(await readFile(join(root, path), 'utf8'))

test('ambiguous bytes return encoding candidates without creating a project', async () => {
	const dir = await workspace()
	const source = join(dir, 'ambiguous.txt')
	await writeFile(source, Buffer.from('a4a4', 'hex'))
	const options = {
		sourcePath: source,
		folder: dir,
		title: '中',
		references: [],
	}
	const result = await importTxtProject(options)
	expect(result.status).toBe('encoding')
	expect(await readdir(dir)).toEqual(['ambiguous.txt'])
	const ready = await importTxtProject({ ...options, encoding: 'big5' })
	expect(ready.status).toBe('ready')
	if (ready.status !== 'ready') return
	expect(ready.encoding).toBe('big5')
	expect(
		await readFile(
			join(ready.projectDir, 'source/chapters/ch0001.txt'),
			'utf8',
		),
	).toBe('中\n')
})

test('the suggested layout reproduces the M1a import exactly', async () => {
	const dir = await workspace()
	const view = await importTxtProject({
		sourcePath: fixture.pathname,
		folder: dir,
		title: '风',
		references: [],
	})
	if (view.status !== 'ready') throw new Error('expected a project')
	expect(view.paragraphs).toBe(7)
	expect(view.layout).toEqual(view.suggested)
	expect(view.layout.volumes).toEqual([
		{ title: '第一卷', start: 0 },
		{ title: '第一卷 风起', start: 1 },
		{ title: '第二卷 风止', start: 4 },
	])
	const before = await tree(view.projectDir)
	await reviseTxtProject(view.projectDir, view.layout)
	expect(await tree(view.projectDir)).toEqual(before)
})

test('revisions rewrite chapters, volumes, settings and findings', async () => {
	const dir = await workspace()
	const image = join(dir, 'ref.PNG')
	await writeFile(image, 'not-decoded')
	const source = join(dir, 'fuzzy.txt')
	await writeFile(
		source,
		`${await readFile(fixture, 'utf8')}\nChapter One 余波\n`,
	)
	const view = await importTxtProject({
		sourcePath: source,
		folder: dir,
		title: '风',
		references: [image],
	})
	if (view.status !== 'ready') throw new Error('expected a project')
	expect(view.references).toEqual(['source/references/01.png'])
	expect(view.findings).toEqual([
		{ paragraph: 6, note: '疑似标题，保留在正文待核对：Chapter One 余波' },
	])
	expect(view.layout.confirmWithReferences).toBe(true)
	let layout = renameChapter(view.layout, 1, '序章 门')
	layout = splitChapter(layout, 2, view.paragraphs)
	layout = mergeChapter(layout, 6)
	layout = mergeVolume(layout, 1)
	layout = startVolume(layout, 1)
	layout = {
		...layout,
		title: '风 修订',
		confirmWithReferences: false,
		volumes: layout.volumes.map((volume, i) => ({
			...volume,
			title: ['上卷', '风起', '第二卷 风止'][i],
		})),
	}
	const revised = await reviseTxtProject(view.projectDir, layout)
	expect(revised.layout).toEqual(layout)
	expect(revised.workId).toBe(view.workId)
	const root = view.projectDir
	const series = await json(root, 'series.json')
	expect(series).toMatchObject({
		title: '风 修订',
		volumeIds: ['v0001', 'v0002', 'v0003'],
	})
	const chapters: [string, string, string][] = []
	for (const volumeId of series.volumeIds) {
		const volume = await json(root, `volumes/${volumeId}/volume.json`)
		const work = await json(
			root,
			`volumes/${volumeId}/works/${volume.workIds[0]}/work.json`,
		)
		expect(work.title).toBe('风 修订')
		expect(work.settings.confirmWithReferences).toBe(false)
		for (const chapterId of work.chapterIds) {
			const chapter = await json(
				root,
				`volumes/${volumeId}/works/${volume.workIds[0]}/chapters/${chapterId}/chapter.json`,
			)
			chapters.push([
				volume.title,
				chapter.title,
				await readFile(join(root, `source/chapters/${chapterId}.txt`), 'utf8'),
			])
		}
	}
	expect(chapters).toEqual([
		['上卷', '前言', '合成前言：风从山上来。\n'],
		['风起', '序章 门', '她推开了门。\n'],
		['风起', '第一章 归来', '她说：“我们回家。”\n'],
		['风起', '第一章 归来（续）', '风吹过山林。\n'],
		['风起', '第二章 远方', '他站在门外。\n'],
		['第二卷 风止', '楔子', '天亮了。\n\n他们再次相见。\n\nChapter One 余波\n'],
	])
	expect(
		await readFile(join(root, 'source/chapters/ch0003.notes.txt'), 'utf8'),
	).toContain('www.example.com')
	const report = await json(root, 'source/import-report.json')
	const ids = chapters.map((_, i) => `ch${String(i + 1).padStart(4, '0')}`)
	expect(report.check.title).toBe('风 修订')
	expect(report.check.chapterFindings).toEqual([
		{
			chapterId: ids[5],
			note: 'fuzzy-heading: 疑似标题，保留在正文待核对 (line 27: Chapter One 余波)',
		},
	])
	expect(await readdir(join(root, 'volumes'))).toEqual([
		'v0001',
		'v0002',
		'v0003',
	])
})

test('invalid layouts are rejected', () => {
	const base = {
		title: '风',
		language: 'zh-CN',
		confirmWithReferences: true,
		chapters: [
			{ title: '一', start: 0 },
			{ title: '二', start: 2 },
		],
		volumes: [{ title: '卷', start: 0 }],
	}
	expect(() => validateLayout(base, 3)).not.toThrow()
	expect(() =>
		validateLayout({ ...base, chapters: [{ title: '一', start: 1 }] }, 3),
	).toThrow()
	expect(() => validateLayout(base, 1)).toThrow()
	expect(() =>
		validateLayout(
			{ ...base, volumes: [...base.volumes, { title: '卷', start: 0 }] },
			3,
		),
	).toThrow()
	expect(() => validateLayout({ ...base, title: ' ' }, 3)).toThrow()
})
