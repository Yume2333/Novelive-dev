import { readFile } from 'node:fs/promises'
import { compile } from '@earendil-works/pi-schema'
import { expect, test } from 'vitest'
import { importExtractionSchema } from '../../packages/creator/src/contract/import'
import { extractPdf } from '../../packages/creator/src/import/pdf'
import { parseTxt } from '../../packages/creator/src/import/txt/structure'

const fixture = (name: string) =>
	readFile(new URL(`../fixtures/source/pdf/${name}.pdf`, import.meta.url))

test('handles a long sequence of zone folios without losing repeated body lines', async () => {
	const result = await extractPdf(await fixture('many-folios'))
	if (result.status !== 'ready') throw new Error('Expected text PDF')
	expect(result.book.volumes[0].chapters).toHaveLength(1)
	expect(result.book.volumes[0].chapters[0].paragraphs).toHaveLength(119)
})

test('keeps soft-wrapped note text together but closes the note at a page change', async () => {
	const result = await extractPdf(await fixture('wrapped-notes'))
	if (result.status !== 'ready') throw new Error('Expected text PDF')
	expect(result.book.volumes[0].chapters[0]).toMatchObject({
		paragraphs: ['Body sentence.', 'New page prose continues here.'],
		notes: ['[1] A note begins and continues'],
	})
})

test('retains nonsequenced number headings in zones and bare folios with only two pages of evidence', async () => {
	const chapters = await extractPdf(await fixture('zone-chapters'))
	if (chapters.status !== 'ready') throw new Error('Expected text PDF')
	expect(chapters.book.volumes[0].chapters.map(({ title }) => title)).toEqual([
		'1',
		'5',
		'9',
	])
	const folios = await extractPdf(await fixture('two-folios'))
	if (folios.status !== 'ready') throw new Error('Expected text PDF')
	expect(
		folios.book.volumes[0].chapters.flatMap(({ paragraphs }) => paragraphs),
	).toContain('10')
})

test('keeps repeated prose at page edges without header or footer gaps', async () => {
	const result = await extractPdf(await fixture('repeated-prose'))
	if (result.status !== 'ready') throw new Error('Expected text PDF')
	expect(result.book.volumes[0].chapters[0].paragraphs).toEqual([
		'A first sentence.',
		'The refrain.',
		'Another sentence.',
		'An answer.',
		'The refrain.',
	])
})

test('discarded left folios do not shift body margins or split soft wraps', async () => {
	const result = await extractPdf(await fixture('left-folio'))
	if (result.status !== 'ready') throw new Error('Expected text PDF')
	expect(result.book.volumes[0].chapters[0].paragraphs).toEqual([
		'The first line continues here.',
	])
})

test('removes consecutive running headers and footers, keeping the first chapter heading', async () => {
	const result = await extractPdf(await fixture('running-edges'))
	if (result.status !== 'ready') throw new Error('Expected text PDF')
	expect(result.book.volumes[0].chapters).toEqual([
		{
			title: 'Chapter 2',
			paragraphs: ['The story begins and continues on and on to its ending.'],
			notes: [],
		},
	])
})

test('preserves bare-number chapter headings but removes three sequenced left-aligned zone page numbers', async () => {
	const chapters = await extractPdf(await fixture('numbered-chapters'))
	if (chapters.status !== 'ready') throw new Error('Expected text PDF')
	expect(chapters.book.volumes[0].chapters.map(({ title }) => title)).toEqual([
		'1',
		'2',
		'3',
	])
	const pages = await extractPdf(await fixture('bare-page-numbers'))
	if (pages.status !== 'ready') throw new Error('Expected text PDF')
	expect(pages.book.volumes[0].chapters).toHaveLength(1)
	expect(pages.book.volumes[0].chapters[0].paragraphs).toHaveLength(8)
})

test('isolates note starts and watermarks without swallowing adjacent prose', async () => {
	const result = await extractPdf(await fixture('notes'))
	if (result.status !== 'ready') throw new Error('Expected text PDF')
	const chapter = result.book.volumes[0].chapters[0]
	expect(chapter.paragraphs).toEqual([
		'Unfinished prose',
		'Body continues.',
		'Last body sentence.',
	])
	expect(chapter.notes).toEqual(['[1] Translator note', 'www.example.com'])
	const txt = parseTxt(
		'Chapter 1\n\nUnfinished prose\n\n[1] Translator note\n\nBody continues.\n\nwww.example.com\n\nLast body sentence.',
	).volumes[0].chapters[0]
	expect(chapter.paragraphs).toEqual(txt.paragraphs.map(({ text }) => text))
	expect(chapter.notes).toEqual(txt.notes)
})

test('extracts body and metadata, merging pages before recognizing chapters', async () => {
	const bytes = await fixture('text')
	const result = await extractPdf(bytes)
	expect(compile(importExtractionSchema).check(result)).toBe(true)
	expect(result).toMatchObject({
		status: 'ready',
		book: {
			format: 'pdf',
			metadata: { title: 'A local novel' },
			volumes: [
				{
					chapters: [
						{
							title: 'Chapter 1',
							paragraphs: ['The first page ends here.', 'The story continues.'],
							notes: [],
						},
						{
							title: 'Chapter 2',
							paragraphs: ['A second chapter.'],
							notes: [],
						},
					],
				},
			],
		},
	})
	expect(bytes.byteLength).toBeGreaterThan(0)
})

test('pages without headings remain a single body chapter', async () => {
	const result = await extractPdf(await fixture('plain'))
	if (result.status !== 'ready') throw new Error('Expected text PDF')
	expect(result.book.volumes).toHaveLength(1)
	expect(result.book.volumes[0].chapters).toEqual([
		{
			title: '正文',
			paragraphs: ['No heading on this page.', 'Still the same chapter.'],
			notes: [],
		},
	])
})

test.each(['image-only', 'blank'])(
	'%s PDF clearly reports unsupported, not an empty book',
	async (name) => {
		expect(await extractPdf(await fixture(name))).toEqual({
			status: 'unsupported',
			format: 'pdf',
			reason: 'no_extractable_text',
		})
	},
)

test('malformed and empty inputs reject rather than being mislabeled as scans', async () => {
	await expect(extractPdf(new Uint8Array())).rejects.toThrow()
	await expect(
		extractPdf(new TextEncoder().encode('not a PDF')),
	).rejects.toThrow()
})

test.each([
	[
		'cjk-wrap',
		['他走过长长的街道看见远处的灯火正在慢慢亮起。', '她站在门外等待。'],
	],
	[
		'english-wrap',
		[
			'The traveler followed the international road toward the quiet village.',
			'Another sentence.',
		],
	],
	[
		'layout',
		[
			'An unfinished thought with a soft wrap',
			'A new paragraph continued here',
			'Indented start ends here.',
		],
	],
] as const)(
	'%s preserves paragraphs rather than visual lines',
	async (name, paragraphs) => {
		const result = await extractPdf(await fixture(name))
		expect(compile(importExtractionSchema).check(result)).toBe(true)
		if (result.status !== 'ready') throw new Error('Expected text PDF')
		expect(result.book.volumes[0].chapters).toHaveLength(1)
		expect(result.book.volumes[0].chapters[0].paragraphs).toEqual(paragraphs)
	},
)
