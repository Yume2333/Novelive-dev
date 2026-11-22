import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { afterEach, expect, test } from 'vitest'
import {
	decodeTxt,
	detectTxtEncoding,
	encodings,
	headingRules,
	importTxt,
	MAX_CHAPTER_CHARS,
	parseTxt,
	TxtEncodingError,
} from '../../packages/creator/src/import/txt'
import { Project } from '../../packages/creator/src/project'
import { paragraphId, projectFiles } from '../../packages/format/src/model'
import encoded from '../fixtures/source/txt/encodings.json'

const fixture = new URL(
	'../fixtures/source/txt/multivolume.txt',
	import.meta.url,
)
const simplified = '第一章 风来了\n她推开了门。风吹过山林，她说：我们回家。\n'
test.each(encodings)('strictly decodes synthetic %s bytes', (encoding) => {
	const expected =
		encoding === 'big5'
			? '第一章 風來了\n她推開了門。風吹過山林，她說：我們回家。\n'
			: encoding === 'shift_jis'
				? '第一章 はじまり\n彼女は扉を開けた。風が山を通り、家に帰ろうと言った。\n'
				: simplified
	const result = decodeTxt(Buffer.from(encoded[encoding], 'hex'))
	expect(result.encoding).toBe(encoding)
	expect(result.text).toBe(expected)
})
test.each([
	['utf-8', 'efbbbf'],
	['utf-16le', 'fffe'],
	['utf-16be', 'feff'],
] as const)('BOM takes priority for %s', (encoding, bom) => {
	expect(decodeTxt(Buffer.from(bom + encoded[encoding], 'hex')).encoding).toBe(
		encoding,
	)
})
test('ASCII and empty input pass through, binary and malformed BOM input fail', () => {
	expect(decodeTxt(Buffer.from('Chapter 1\nHello!')).text).toBe(
		'Chapter 1\nHello!',
	)
	expect(decodeTxt(new Uint8Array()).text).toBe('')
	expect(() => decodeTxt(Buffer.from([0, 1, 2, 3]))).toThrow(TxtEncodingError)
	expect(() => decodeTxt(Buffer.from('efbbbfff', 'hex'))).toThrow(
		TxtEncodingError,
	)
	expect(() => decodeTxt(Buffer.from([0xff]), 'utf-8')).toThrow(
		TxtEncodingError,
	)
})
test('ambiguous input yields up to three previews and accepts an explicit encoding', () => {
	const bytes = Buffer.from('a4a4', 'hex')
	const candidates = detectTxtEncoding(bytes)
	expect(candidates.length).toBeGreaterThan(1)
	expect(candidates.length).toBeLessThanOrEqual(3)
	expect(candidates.every((candidate) => candidate.preview.length > 0)).toBe(
		true,
	)
	expect(() => decodeTxt(bytes)).toThrow(TxtEncodingError)
	expect(decodeTxt(bytes, 'big5').text).toBe('中')
})
test('main and auxiliary rules form a union; volumes, preface and cleanup are preserved', async () => {
	const result = parseTxt(await readFile(fixture, 'utf8'))
	expect(result.mainRule).toBe('numbered')
	expect(result.volumes.map((volume) => volume.title)).toEqual([
		'第一卷',
		'第一卷 风起',
		'第二卷 风止',
	])
	const chapters = result.volumes.flatMap((volume) => volume.chapters)
	expect(chapters.map((chapter) => chapter.title)).toEqual([
		'前言',
		'序章',
		'第一章 归来',
		'第二章 远方',
		'楔子',
		'第一章 再会',
	])
	const chapter = chapters[2]
	expect(chapter.paragraphs).toEqual([
		{ id: 'p0001', text: '她说：“我们回家。”' },
		{ id: 'p0002', text: '风吹过山林。' },
	])
	expect(chapter.notes).toEqual([
		'www.example.com',
		'请收藏本书',
		'① 合成脚注，不是真书。',
		'【版权页】合成文本',
		'仅供自动测试。',
		'第二章 …… 12',
	])
	expect(chapters[3].paragraphs[0].text).toBe('他站在门外。')
})
test('bare digits need three hits, highest-hit rule wins, and volumes alone become chapters', () => {
	expect(parseTxt('1\n正文\n2\n正文').mainRule).toBeUndefined()
	expect(parseTxt('1\n正文\n2\n正文\n3\n正文').mainRule).toBe('digits')
	expect(parseTxt('第一章\n正文\n1\n正文\n2\n正文\n3\n正文').mainRule).toBe(
		'digits',
	)
	const result = parseTxt('第一本\n正文\n第二本\n正文')
	expect(result.volumes).toHaveLength(1)
	expect(result.volumes[0].chapters.map((chapter) => chapter.title)).toEqual([
		'第一本',
		'第二本',
	])
	expect(result.findings[0].code).toBe('volumes-as-chapters')
	expect(parseTxt('第一折\n正文').volumes[0].chapters[0].title).toBe('第一折')
	expect(
		parseTxt('上卷\n第一章\n正文\n下卷\n第二章\n正文').volumes,
	).toHaveLength(2)
})
test('reports fuzzy headings, duplicate and empty chapters and volumes without dropping text', () => {
	const result = parseTxt(
		'第一卷\n第二卷\n第一章\n第一章\n正文\n第？章 异形\n第三卷',
	)
	const codes = result.findings.map((finding) => finding.code)
	expect(codes).toEqual(
		expect.arrayContaining([
			'fuzzy-heading',
			'empty-chapter',
			'duplicate-chapter',
			'empty-volume',
		]),
	)
	expect(
		result.volumes
			.flatMap((volume) => volume.chapters)
			.flatMap((chapter) => chapter.paragraphs)
			.map((paragraph) => paragraph.text),
	).toContain('第？章 异形')
})
test('normalizes line endings, honors custom rules and keeps stable paragraph IDs', () => {
	const text = '\ufeff第一章\r\n　她回家。\r\n\r\n删除这行\r\n风停了。'
	const options = { cleanupRules: [/^删除/g] }
	const first = parseTxt(text, options)
	expect(first).toEqual(parseTxt(text, options))
	expect(
		first.volumes[0].chapters[0].paragraphs.map((paragraph) => paragraph.id),
	).toEqual(['p0001', 'p0002'])
	expect(first.volumes[0].chapters[0].notes).toEqual(['删除这行'])
	const rules = headingRules.map((rule) => ({ ...rule, enable: false }))
	rules.push({
		name: 'custom',
		pattern: /^幕\d+$/,
		kind: 'chapter',
		example: '幕1',
		enable: true,
	})
	expect(parseTxt('幕1\n内容', { rules }).mainRule).toBe('custom')
})
test('splits long chapters only at paragraph boundaries and reports indivisible long paragraphs', () => {
	const paragraph = '字'.repeat(10000)
	const result = parseTxt(`第一章\n${paragraph}\n${paragraph}`)
	const chapters = result.volumes[0].chapters
	expect(chapters.map((chapter) => chapter.title)).toEqual([
		'第一章（1）',
		'第一章（2）',
	])
	expect(
		chapters.every(
			(chapter) =>
				chapter.paragraphs.map((paragraph) => paragraph.text).join('\n')
					.length <= MAX_CHAPTER_CHARS,
		),
	).toBe(true)
	expect(
		chapters
			.flatMap((chapter) => chapter.paragraphs)
			.map((paragraph) => paragraph.text)
			.join(''),
	).toBe(paragraph + paragraph)
	expect(parseTxt('字'.repeat(MAX_CHAPTER_CHARS + 1)).findings[0].code).toBe(
		'oversized-paragraph',
	)
})
test('empty input and no headings still create a single inspectable chapter', () => {
	expect(parseTxt('').volumes[0].chapters[0].paragraphs).toEqual([])
	expect(parseTxt('只是正文。').volumes[0].chapters[0].title).toBe('正文')
})

test('flags skipped and reversed chapter and volume numbering', () => {
	const result = parseTxt(
		'第一卷\n第一章\n甲\n第三章\n乙\n第三卷\n第二章\n丙\n第一章\n丁',
	)
	expect(result.findings.map((finding) => finding.code)).toEqual(
		expect.arrayContaining(['chapter-sequence', 'volume-sequence']),
	)
})

test('volume titles do not require a space before their subtitle', () => {
	expect(
		parseTxt('第一卷风起\n第一章\n正文\n第二卷风止\n第二章\n正文').volumes.map(
			(volume) => volume.title,
		),
	).toEqual(['第一卷风起', '第二卷风止'])
})

test('BOM-less UTF-16 can be sniffed from Chinese punctuation without ASCII', () => {
	const text = '她推开了门。风吹过山林，她说我们回家。'
	const le = Buffer.from(text, 'utf16le')
	expect(decodeTxt(le).text).toBe(text)
	expect(decodeTxt(Buffer.from(le).swap16()).encoding).toBe('utf-16be')
})

test('the shared paragraph contract accepts IDs beyond four digits but not zero', () => {
	expect(compile(paragraphId).check('p10000')).toBe(true)
	expect(compile(paragraphId).check('p00000')).toBe(false)
})

const directories: string[] = []
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	)
})
test('real importer saves original bytes, body, notes, chapter IDs, hierarchy and report; reopen works', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-txt-'))
	directories.push(directory)
	const root = join(directory, 'project')
	const bytes = await readFile(fixture)
	const project = await Project.create(root, {
		formatVersion: 1,
		seriesId: 'synthetic',
		title: '风',
		volumeIds: [],
	})
	const report = await importTxt(project, bytes, { title: '风' })
	await expect(importTxt(project, bytes, { title: '风' })).rejects.toThrow(
		'empty project',
	)
	project.close()
	using reopened = await Project.open(root)
	expect(await reopened.readFile(projectFiles.original('txt'))).toEqual(bytes)
	expect(await reopened.read(projectFiles.importReport)).toEqual(report)
	const series = await reopened.read(projectFiles.series)
	for (const volumeId of series.volumeIds) {
		const volume = await reopened.read(projectFiles.volume(volumeId))
		const workId = volume.workIds[0]
		const work = await reopened.read(projectFiles.work(volumeId, workId))
		for (const chapterId of work.chapterIds) {
			const chapter = await reopened.read(
				projectFiles.chapter({ volumeId, workId, chapterId }),
			)
			const body = (
				await reopened.readFile(projectFiles.chapterText(chapterId))
			).toString()
			expect(body).not.toMatch(/请收藏|www\.|脚注|版权页/)
			expect(chapter.paragraphIds).toHaveLength(
				body.trim() ? body.trim().split('\n\n').length : 0,
			)
			await expect(
				reopened.readFile(projectFiles.chapterNotes(chapterId)),
			).resolves.toBeInstanceOf(Buffer)
		}
	}
})
test('encoding errors do not write source files or mutate the series', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-txt-error-'))
	directories.push(directory)
	using project = await Project.create(join(directory, 'project'), {
		formatVersion: 1,
		seriesId: 'synthetic',
		title: '风',
		volumeIds: [],
	})
	await expect(
		importTxt(project, Buffer.from([0, 1]), { title: '风' }),
	).rejects.toThrow(TxtEncodingError)
	expect((await project.read(projectFiles.series)).volumeIds).toEqual([])
	await expect(project.readFile(projectFiles.original('txt'))).rejects.toThrow()
})
