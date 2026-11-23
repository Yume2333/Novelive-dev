import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import {
	TextReader,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { SaxesParser } from 'saxes'
import { describe, expect, test } from 'vitest'
import {
	importCommands,
	importExtractionSchema,
	importJoinTargetSchema,
	workVolumeLinkSchema,
} from '../../packages/creator/src/contract/import'
import {
	productionQueueSchema,
	productionUsageSchema,
} from '../../packages/creator/src/contract/queue'

const ready = compile(importExtractionSchema)
const volumes = [
	{
		title: '第一卷',
		chapters: [{ title: '第一章', paragraphs: ['正文。'], notes: ['译者注'] }],
	},
]

describe('longform payloads', () => {
	const link = {
		seriesId: 'series-1',
		volumeId: 'v0001',
		workId: '12345678-0000-4000-8000-000000000001',
	}
	const work = { link, title: '第一部', projectDir: '/projects/series-1' }

	test.each(['markdown', 'docx', 'pdf'] as const)(
		'%s emits the common volume, chapter, body and note shape',
		(format) => {
			const book = { format, volumes, metadata: { language: 'zh-Hans' } }
			expect(ready.check({ status: 'ready', book })).toBe(true)
			expect(
				ready.check({ status: 'ready', book: { ...book, volumes: [] } }),
			).toBe(false)
		},
	)

	test.each(['nav', 'ncx', 'heading', 'spine'] as const)(
		'EPUB records %s provenance and locates unselected illustrations',
		(navigation) => {
			const illustration = {
				archivePath: 'OEBPS/images/one.png',
				volume: 0,
				chapter: 0,
				paragraph: 0,
			}
			const book = {
				format: 'epub',
				volumes,
				metadata: { title: '测试小说', language: 'zh-Hans' },
				navigation,
				illustrations: [illustration],
			}
			expect(ready.check({ status: 'ready', book })).toBe(true)
			for (const archivePath of [
				'../one.png',
				'/one.png',
				'https://host/one.png',
			]) {
				expect(
					ready.check({
						status: 'ready',
						book: {
							...book,
							illustrations: [{ ...illustration, archivePath }],
						},
					}),
				).toBe(false)
			}
			expect(
				ready.check({
					status: 'ready',
					book: {
						...book,
						illustrations: [{ ...illustration, selected: true }],
					},
				}),
			).toBe(false)
		},
	)

	test('no extractable PDF text is not a successful empty book', () => {
		const result = {
			status: 'unsupported',
			format: 'pdf',
			reason: 'no_extractable_text',
		}
		expect(ready.check(result)).toBe(true)
		expect(ready.check({ ...result, format: 'docx' })).toBe(false)
		expect(ready.check({ ...result, reason: 'ocr_required' })).toBe(false)
		expect(
			ready.check({
				status: 'ready',
				book: {
					format: 'pdf',
					metadata: {},
					volumes: [
						{
							title: '卷',
							chapters: [{ title: '章', paragraphs: [], notes: [] }],
						},
					],
				},
			}),
		).toBe(false)
	})

	test('links a work to its volume and joins a series without selecting a volume', () => {
		const linkValidator = compile(workVolumeLinkSchema)
		expect(linkValidator.check(link)).toBe(true)
		expect(linkValidator.check({ ...link, volumeId: '../v0001' })).toBe(false)
		const target = { projectDir: work.projectDir, seriesId: link.seriesId }
		const joinTarget = compile(importJoinTargetSchema)
		expect(joinTarget.check(target)).toBe(true)
		expect(joinTarget.check({ ...target, volumeId: link.volumeId })).toBe(false)
	})

	test('keeps the TXT encoding choice contract unchanged', () => {
		expect(
			compile(importCommands['import.txt'].output).check({
				status: 'encoding',
				candidates: [
					{ encoding: 'gb18030', preview: '正文' },
					{ encoding: 'big5', preview: '正文' },
				],
			}),
		).toBe(true)
	})

	test('queue distinguishes the active slot, ordered waiting works and paused works', () => {
		const queueValidator = compile(productionQueueSchema)
		const next = {
			...work,
			link: { ...link, workId: '12345678-0000-4000-8000-000000000002' },
		}
		const queue = {
			active: { ...work, status: 'active' },
			queued: [{ ...next, status: 'queued' }],
			inactive: [
				{
					...next,
					link: { ...link, workId: '12345678-0000-4000-8000-000000000003' },
					status: 'awaiting_confirm',
					reason: 'confirm_first',
				},
			],
		}
		expect(queueValidator.check(queue)).toBe(true)
		expect(queueValidator.check({ ...queue, active: queue.queued[0] })).toBe(
			false,
		)
		expect(queueValidator.check({ ...queue, queued: queue.inactive })).toBe(
			false,
		)
		expect(
			queueValidator.check({
				active: null,
				queued: queue.queued,
				inactive: [{ ...work, status: 'paused', reason: 'crashed' }],
			}),
		).toBe(true)
	})

	test('usage records measured counts and distinguishes zero cost from missing prices', () => {
		const usage = compile(productionUsageSchema)
		const text = {
			link,
			at: 1_700_000_000_000,
			phase: 'write',
			model: 'text-model',
			kind: 'text',
			inputTokens: 100,
			outputTokens: 30,
			cacheReadTokens: 60,
			cacheWriteTokens: 0,
			costUsd: null,
		}
		const image = {
			link,
			at: text.at,
			phase: 'draw',
			model: 'image-model',
			kind: 'image',
			imageCount: 2,
			costUsd: 0,
		}
		expect(usage.check(text)).toBe(true)
		expect(usage.check(image)).toBe(true)
		expect(usage.check({ ...image, costUsd: 0.025 })).toBe(true)
		expect(usage.check({ ...image, costUsd: -1 })).toBe(false)
		expect(usage.check({ ...text, inputTokens: 0.5 })).toBe(false)
		expect(usage.check({ ...image, outputTokens: 0 })).toBe(false)
	})
})

async function zipParts(parts: Record<string, string>) {
	const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false })
	for (const [name, value] of Object.entries(parts)) {
		await zip.add(name, new TextReader(value))
	}
	const bytes = await zip.close()
	const reader = new ZipReader(new Uint8ArrayReader(bytes), {
		useWebWorkers: false,
	})
	try {
		const entries = await reader.getEntries()
		const byName = new Map(
			await Promise.all(
				entries.flatMap((entry) =>
					entry.directory
						? []
						: [
								entry
									.getData(new Uint8ArrayWriter(), { checkSignature: true })
									.then(
										(data) =>
											[
												entry.filename,
												new TextDecoder('utf-8', { fatal: true }).decode(data),
											] as const,
									),
							],
				),
			),
		)
		return (name: string) => {
			const value = byName.get(name)
			if (value === undefined) throw new Error(`Missing ZIP part: ${name}`)
			return value
		}
	} finally {
		await reader.close()
	}
}

function xmlEvents(source: string) {
	const parser = new SaxesParser({ xmlns: true })
	const tags: {
		name: string
		uri: string
		attributes: Record<string, string>
	}[] = []
	const text: string[] = []
	parser.on('opentag', (tag) =>
		tags.push({
			name: tag.local,
			uri: tag.uri,
			attributes: Object.fromEntries(
				Object.values(tag.attributes).map(({ local, value }) => [local, value]),
			),
		}),
	)
	parser.on('text', (value) => text.push(value))
	parser.write(source).close()
	return { tags, text }
}

function elements(
	node: DefaultTreeAdapterTypes.Node,
): DefaultTreeAdapterTypes.Element[] {
	return [
		...('tagName' in node ? [node] : []),
		...('childNodes' in node ? node.childNodes.flatMap(elements) : []),
	]
}

// Assembly keeps byte offsets correct and lets both PDF cases run offline.
function onePagePdf(resources: string, content: string, extras: string[]) {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources ${resources} /Contents 4 0 R >>`,
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		...extras,
		'<< /Title (A local novel) >>',
	]
	let pdf = '%PDF-1.4\n'
	const offsets = objects.map((object, index) => {
		const offset = pdf.length
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
		return `${String(offset).padStart(10, '0')} 00000 n \n`
	})
	const xref = pdf.length
	const size = objects.length + 1
	pdf += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.join('')}`
	pdf += `trailer\n<< /Size ${size} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return new TextEncoder().encode(pdf)
}

describe('local parser probes', () => {
	test('EPUB: ZIP, OPF and NCX XML, nav and heading XHTML are readable', async () => {
		const files = await zipParts({
			'META-INF/container.xml':
				'<container><rootfile full-path="OEBPS/book.opf"/></container>',
			'OEBPS/book.opf':
				'<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>测试小说</dc:title><dc:language>zh-Hans</dc:language></metadata><manifest><item id="nav" properties="nav" href="nav.xhtml"/><item id="toc" href="book.ncx"/><item id="ch" href="one.xhtml"/></manifest><spine toc="toc"><itemref idref="ch"/></spine></package>',
			'OEBPS/nav.xhtml':
				'<nav epub:type="toc"><ol><li><span>卷一</span><ol><li><a href="one.xhtml#first">第一章</a></li></ol></li></ol></nav>',
			'OEBPS/book.ncx':
				'<ncx><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="one.xhtml#first"/></navPoint></navMap></ncx>',
			'OEBPS/one.xhtml': '<h1 id="first">第一章</h1><p>正文 &amp; 插图。</p>',
		})
		const container = xmlEvents(files('META-INF/container.xml'))
		expect(container.tags[1].attributes['full-path']).toBe('OEBPS/book.opf')
		const opf = xmlEvents(files('OEBPS/book.opf'))
		expect(opf.text).toEqual(['测试小说', 'zh-Hans'])
		expect(
			opf.tags.find(({ name }) => name === 'itemref')?.attributes.idref,
		).toBe('ch')
		const nav = elements(parseFragment(files('OEBPS/nav.xhtml')))
		expect(nav.filter(({ tagName }) => tagName === 'ol')).toHaveLength(2)
		expect(nav.find(({ tagName }) => tagName === 'a')?.attrs).toContainEqual({
			name: 'href',
			value: 'one.xhtml#first',
		})
		const ncx = xmlEvents(files('OEBPS/book.ncx'))
		expect(
			ncx.tags.find(({ name }) => name === 'content')?.attributes.src,
		).toBe('one.xhtml#first')
		const chapter = elements(parseFragment(files('OEBPS/one.xhtml')))
		expect(chapter.map(({ tagName }) => tagName)).toEqual(['h1', 'p'])
	})

	test('Markdown: UTF-8 BOM, Setext and ATX headings, and footnotes are distinct', () => {
		const bytes = new TextEncoder().encode(
			'\uFEFF卷一\n===\n\n## 第一章\n\n正文。[^1]\n\n[^1]: 译者注',
		)
		const tree = fromMarkdown(bytes, 'utf8', {
			extensions: [gfmFootnote()],
			mdastExtensions: [gfmFootnoteFromMarkdown()],
		})
		expect(tree.children).toMatchObject([
			{ type: 'heading', depth: 1, children: [{ value: '卷一' }] },
			{ type: 'heading', depth: 2, children: [{ value: '第一章' }] },
			{
				type: 'paragraph',
				children: [{ value: '正文。' }, { type: 'footnoteReference' }],
			},
			{ type: 'footnoteDefinition', identifier: '1' },
		])
	})

	test('DOCX: namespaced heading styles, metadata and footnotes remain distinguishable', async () => {
		const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
		const files = await zipParts({
			'docProps/core.xml':
				'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>试读</dc:title><dc:language>zh-Hans</dc:language></cp:coreProperties>',
			'word/document.xml': `<w:document xmlns:w="${word}"><w:body><w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p><w:p><w:r><w:t>正文。</w:t><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>`,
			'word/styles.xml': `<w:styles xmlns:w="${word}"><w:style w:styleId="H1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
			'word/footnotes.xml': `<w:footnotes xmlns:w="${word}"><w:footnote w:id="1"><w:p><w:r><w:t>译者注</w:t></w:r></w:p></w:footnote></w:footnotes>`,
		})
		expect(xmlEvents(files('docProps/core.xml')).text).toEqual([
			'试读',
			'zh-Hans',
		])
		const doc = xmlEvents(files('word/document.xml'))
		expect(doc.text).toEqual(['第一章', '正文。'])
		expect(doc.tags).toContainEqual({
			name: 'pStyle',
			uri: word,
			attributes: { val: 'H1' },
		})
		expect(doc.tags).toContainEqual({
			name: 'footnoteReference',
			uri: word,
			attributes: { id: '1' },
		})
		expect(xmlEvents(files('word/styles.xml')).tags).toContainEqual({
			name: 'outlineLvl',
			uri: word,
			attributes: { val: '0' },
		})
		expect(xmlEvents(files('word/footnotes.xml')).text).toEqual(['译者注'])
	})

	test('PDF: local character maps recover CJK text; an image-only page has no text', async () => {
		const require = createRequire(import.meta.url)
		const root = dirname(require.resolve('pdfjs-dist/package.json'))
		const cMapUrl = join(root, 'cmaps') + sep
		const textPdf = onePagePdf(
			'<< /Font << /F1 5 0 R >> >>',
			'BT /F1 12 Tf 72 320 Td <4e2d6587> Tj ET',
			[
				'<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>',
				'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 >>',
			],
		)
		const scanPdf = onePagePdf(
			'<< /XObject << /Im1 5 0 R >> >>',
			'q 10 0 0 10 10 10 cm /Im1 Do Q',
			[
				'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Length 1 >>\nstream\nA\nendstream',
			],
		)
		for (const [data, expected] of [
			[textPdf, ['中文']],
			[scanPdf, []],
		] as const) {
			const task = getDocument({
				data,
				cMapUrl,
				useWorkerFetch: false,
			})
			try {
				const doc = await task.promise
				expect((await doc.getMetadata()).info).toMatchObject({
					Title: 'A local novel',
				})
				const page = await doc.getPage(1)
				const { items } = await page.getTextContent()
				expect(
					items.flatMap((item) => ('str' in item ? [item.str] : [])),
				).toEqual(expected)
			} finally {
				await task.destroy()
			}
		}
	})
})
