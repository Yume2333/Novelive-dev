import { readFile } from 'node:fs/promises'
import { compile } from '@earendil-works/pi-schema'
import { expect, test } from 'vitest'
import { importExtractionSchema } from '../../packages/creator/src/contract/import'
import {
	extractMarkdown,
	MarkdownImportError,
} from '../../packages/creator/src/import/markdown'

const contract = compile(importExtractionSchema)
const extract = (text: string) => {
	const result = extractMarkdown(new TextEncoder().encode(text))
	expect(contract.check(result)).toBe(true)
	return result.book
}
const fixture = (name: string) =>
	readFile(new URL(`../fixtures/source/markdown/${name}`, import.meta.url))

test.each(['multivolume.md', 'multivolume.atx.md'])(
	'Pandoc %s yields titles, volumes, paragraphs and archived non-body text',
	async (name) => {
		const result = extractMarkdown(await fixture(name))
		expect(contract.check(result)).toBe(true)
		expect(result.book).toEqual({
			format: 'markdown',
			metadata: { title: '风起之城', language: 'zh-Hans' },
			volumes: [
				{
					title: '第一卷 风起',
					chapters: [
						{
							title: '序章',
							paragraphs: [
								'山城在风里醒来。她站在城墙上，看着远处的灯一盏一盏熄灭，像是有人把夜色慢慢收回了口袋。',
							],
							notes: ['目录', '第一卷 风起', '第二卷 远行'],
						},
						{
							title: '第一章 门',
							paragraphs: [
								'她推开了门。风吹过山林，她说："我们回家。"',
								'门外的石阶被雨水洗得发亮，一直延伸到看不见的地方。她数着台阶往下走，数到第三十七级时停了下来。',
								'一',
								'信上只有一句话：等风停了，就回来。',
								'他没有回头。',
							],
							notes: [
								'译者注：原文此处为方言。',
								'注：本章"石阶"一词在旧版中作"石级"。',
							],
						},
						{
							title: '第二章 路',
							paragraphs: [
								'路很长。They walked until the lights of the old town faded behind them, and neither of them said a word about the letter.',
							],
							notes: [],
						},
					],
				},
				{
					title: '第二卷 远行',
					chapters: [
						{
							title: '第三章 海',
							paragraphs: [
								'海是灰色的。船在雾里慢慢靠岸，码头上没有人等他们。',
							],
							notes: ['作者注：这里的海指内海。'],
						},
						{
							title: '第四章 城',
							paragraphs: ['城里的钟楼还在走，只是比别处慢了一刻钟。'],
							notes: [],
						},
					],
				},
				{
					title: '后记',
					chapters: [
						{
							title: '后记',
							paragraphs: ['这个故事写于一个没有风的夏天。'],
							notes: [],
						},
					],
				},
			],
		})
	},
)

test('BOM, CRLF and a lone top heading: the heading titles the book, the next level holds chapters', () => {
	const book = extract(
		'\uFEFF# 雨夜\r\n\r\n## 第一章 灯\r\n\r\n灯亮了。\r\n\r\n## 第二章 窗\r\n\r\n窗开着。\r\n',
	)
	expect(book.metadata).toEqual({ title: '雨夜' })
	expect(book.volumes).toEqual([
		{
			title: '第一卷',
			chapters: [
				{ title: '第一章 灯', paragraphs: ['灯亮了。'], notes: [] },
				{ title: '第二章 窗', paragraphs: ['窗开着。'], notes: [] },
			],
		},
	])
})

test('front matter title wins over a lone top heading; chapter-like top headings keep deeper ones in the body', () => {
	const book = extract(
		"---\ntitle: '它''s'\nlanguage: \"ja\"\n---\n# 第一章\n\n### 一\n\n朝。\n\n# 第二章\n\n夜。\n",
	)
	expect(book.metadata).toEqual({ title: "它's", language: 'ja' })
	expect(book.volumes[0].chapters).toEqual([
		{ title: '第一章', paragraphs: ['一', '朝。'], notes: [] },
		{ title: '第二章', paragraphs: ['夜。'], notes: [] },
	])
})

test('line-per-paragraph text splits at CJK sentence ends and hard breaks, wrapped text joins', () => {
	const book = extract(
		'# 第一章\n\n她笑了。\n他也笑了。\n“走吧，\n去海边。”\n这一句\n没有断开\n\nline one\\\nline two  \nline three\nwraps here\n',
	)
	expect(book.volumes[0].chapters[0].paragraphs).toEqual([
		'她笑了。',
		'他也笑了。',
		'“走吧，去海边。”',
		'这一句没有断开',
		'line one',
		'line two',
		'line three wraps here',
	])
})

test('no headings gives one body chapter; leading text before the first volume becomes a preface volume', () => {
	expect(extract('只有一段。').volumes).toEqual([
		{
			title: '第一卷',
			chapters: [{ title: '正文', paragraphs: ['只有一段。'], notes: [] }],
		},
	])
	const book = extract(
		[
			'开篇的话。',
			'# 上卷',
			'<!-- 编辑备注 -->',
			'## 第一章',
			'![图](a.png)',
			'',
			'***',
			'## 第二章',
			'正文。[^a] 还有 <span>行内</span> *强调*。',
			'# 版权',
			'本书版权所有。',
			'## 印次',
			'第一版。',
			'# 下卷',
			'## 第三章',
			'终。',
			'[^a]: 脚注甲。',
			'[^z]: 未引用的注。',
		].join('\n\n'),
	)
	expect(book.volumes).toEqual([
		{
			title: '前言',
			chapters: [{ title: '前言', paragraphs: ['开篇的话。'], notes: [] }],
		},
		{
			title: '上卷',
			chapters: [
				{
					title: '第二章',
					paragraphs: ['正文。 还有 行内 强调。'],
					notes: ['脚注甲。', '版权', '本书版权所有。', '印次', '第一版。'],
				},
			],
		},
		{
			title: '下卷',
			chapters: [
				{ title: '第三章', paragraphs: ['终。'], notes: ['未引用的注。'] },
			],
		},
	])
})

test('a table-of-contents heading line is not a chapter', () => {
	const book = extract('## 第一章 …… 12\n\n## 第一章\n\n正文。\n')
	expect(book.volumes[0].chapters).toEqual([
		{ title: '第一章', paragraphs: ['正文。'], notes: ['第一章 …… 12'] },
	])
})

test('a leading thematic break is not front matter; YAML comments, escapes and block scalars parse', () => {
	expect(
		extract('---\n\n# 第一章\n\n甲。\n\n---\n\n# 第二章\n\n乙。\n').volumes[0]
			.chapters,
	).toEqual([
		{ title: '第一章', paragraphs: ['甲。'], notes: [] },
		{ title: '第二章', paragraphs: ['乙。'], notes: [] },
	])
	expect(
		extract(
			'---\ntitle: "A \\"Quiet\\" City" # working title\nlang: en # en-US\n---\n正文。\n',
		).metadata,
	).toEqual({ title: 'A "Quiet" City', language: 'en' })
	expect(
		extract('---\ntitle: 港\ntags: [\n  a,\n  b\n]\n---\n正文。\n').metadata,
	).toEqual({ title: '港' })
	expect(
		extract('---\ntitle: Harbor\nlang: en\ntags: [a, # x\n  b\n]\n---\nText.\n')
			.metadata,
	).toEqual({ title: 'Harbor', language: 'en' })
	expect(
		extract(
			'---\ntitle: Harbor\nextra:\n  categories: [\n    sea,\n# note\n]\n---\nText.\n',
		).metadata,
	).toEqual({ title: 'Harbor' })
	expect(
		extract(
			'---\ntitle: Harbor\ndescription: |\n  Excerpt: [A door opens.\nextra:\n  links: ["See\n    the ] sign"]\nlang: en\nmore: {\n  publisher: Harbor Press\n}\n---\nThe ship left.\n',
		),
	).toMatchObject({
		metadata: { title: 'Harbor', language: 'en' },
		volumes: [{ chapters: [{ paragraphs: ['The ship left.'] }] }],
	})
	expect(
		extract('---\ntitle: Matching a literal ]\nlang: en\n---\nText.\n')
			.metadata,
	).toEqual({ title: 'Matching a literal ]', language: 'en' })
	expect(
		extract('---\nReminder: The notice read [KEEP OUT\n]\n\n---\n\nThe end.\n')
			.volumes[0].chapters[0].paragraphs,
	).toEqual(['Reminder: The notice read [KEEP OUT ]', 'The end.'])
	expect(
		extract(
			'---\n\nRead: [the log\n](log.md) first.\n\n---\n\nThe ship left.\n',
		).volumes[0].chapters[0].paragraphs,
	).toEqual(['Read: the log first.', 'The ship left.'])
	expect(
		extract('---\ntitle: >-\n  The Long\n  Road\nauthor: x\n---\n正文。\n')
			.metadata,
	).toEqual({ title: 'The Long Road' })
})

test('a top heading other than the front matter title is a volume', () => {
	const book = extract(
		'---\ntitle: The Long Road\n---\n# Volume I: The Crossing\n\n## Chapter 1\n\nThey left.\n',
	)
	expect(book.metadata).toEqual({ title: 'The Long Road' })
	expect(book.volumes.map((v) => v.title)).toEqual(['Volume I: The Crossing'])
	expect(
		extract('---\ntitle: 雨\n---\n# 雨\n\n## 第一章\n\n落。\n').volumes,
	).toEqual([
		{
			title: '第一卷',
			chapters: [{ title: '第一章', paragraphs: ['落。'], notes: [] }],
		},
	])
})

test('annotation lines stay apart from adjacent prose; heading footnotes and inline comments are handled', () => {
	const book = extract(
		'# 第一章[^t]\n\n注：旧版作小门\n她走进了院子。<!-- a > b -->\n译者注：原版里这里用的是旧地名，\n新版将它改成了海港\n他没回头。\n译者注：旧译章名为《归航》；\n她把信收了起来。\n\n# 第二章\n\n完。\n\n[^t]: 标题注。\n',
	)
	expect(book.volumes[0].chapters).toEqual([
		{
			title: '第一章',
			paragraphs: ['她走进了院子。', '他没回头。', '她把信收了起来。'],
			notes: [
				'标题注。',
				'注：旧版作小门',
				'译者注：原版里这里用的是旧地名，新版将它改成了海港',
				'译者注：旧译章名为《归航》；',
			],
		},
		{ title: '第二章', paragraphs: ['完。'], notes: [] },
	])
})

test('rejects non-UTF-8 bytes and Markdown without body text', () => {
	expect(() => extractMarkdown(Uint8Array.from([0xd5, 0xfd]))).toThrow(
		MarkdownImportError,
	)
	expect(() =>
		extractMarkdown(new TextEncoder().encode('# 目录\n\n- 第一章\n')),
	).toThrow(MarkdownImportError)
})
