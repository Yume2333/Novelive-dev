import { readFile } from 'node:fs/promises'
import { compile } from '@earendil-works/pi-schema'
import { expect, test } from 'vitest'
import { importExtractionSchema } from '../../packages/creator/src/contract/import'
import { extractPdf } from '../../packages/creator/src/import/pdf'

const fixture = (name: string) =>
	readFile(new URL(`../fixtures/source/pdf/${name}.pdf`, import.meta.url))

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
