import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { describe, expect, test } from 'vitest'
import { importExtractionSchema } from '../../packages/creator/src/contract/import'
import {
	DocxImportError,
	extractDocx,
	importDocx,
} from '../../packages/creator/src/import/docx'
import {
	brokenDocx,
	documentXml,
	namespace,
	paragraph as p,
	syntheticDocx,
} from '../fixtures/source/docx/synthetic'
import { drawing, imageRelationships } from '../fixtures/source/illustrations'

const heading = (text: string, level = 1) =>
	p(text, `<w:pStyle w:val="Heading${level}"/>`)
const extract = async (body: string, parts: Record<string, string> = {}) => {
	const result = await extractDocx(
		await syntheticDocx({ 'word/document.xml': documentXml(body), ...parts }),
	)
	expect(compile(importExtractionSchema).check(result)).toBe(true)
	if (result.status !== 'ready' || result.book.format !== 'docx')
		throw new Error('Expected ready DOCX')
	return result.book
}

describe('DOCX extraction', () => {
	test('offers an inline cover before the first heading at the first chapter without a paragraph', async () => {
		const parts = {
			'word/_rels/document.xml.rels': imageRelationships({
				cover: 'media/cover.png',
				inline: 'media/inline.png',
			}),
			'word/media/cover.png': 'cover image',
			'word/media/inline.png': 'inline image',
		}
		const book = await extract(
			drawing('cover') +
				heading('第一卷', 1) +
				heading('第一章', 2) +
				p('正文。') +
				drawing('inline'),
			parts,
		)
		expect(book.illustrations).toEqual([
			{ archivePath: 'word/media/cover.png', volume: 0, chapter: 0 },
			{
				archivePath: 'word/media/inline.png',
				volume: 0,
				chapter: 0,
				paragraph: 0,
			},
		])
		await expect(extract(drawing('cover'), parts)).rejects.toMatchObject({
			code: 'no_extractable_text',
		})
	})

	test('locates embedded inline drawings across volumes and chapters without leaking drawing text', async () => {
		const book = await extract(
			heading('第一卷', 1) +
				heading('第一章', 2) +
				p('第一段。') +
				drawing('one') +
				heading('第二章', 2) +
				drawing('two') +
				p('第二段。') +
				heading('第二卷', 1) +
				heading('第三章', 2) +
				p('第三段。') +
				drawing('one') +
				drawing('missing'),
			{
				'word/_rels/document.xml.rels': imageRelationships({
					one: 'media/a.png',
					two: 'media/b.png',
				}),
				'word/media/a.png': 'image',
				'word/media/b.png': 'image',
			},
		)
		expect(book).toMatchObject({
			illustrations: [
				{
					archivePath: 'word/media/a.png',
					volume: 0,
					chapter: 0,
					paragraph: 0,
				},
				{
					archivePath: 'word/media/b.png',
					volume: 0,
					chapter: 1,
					paragraph: 0,
				},
				{
					archivePath: 'word/media/a.png',
					volume: 1,
					chapter: 0,
					paragraph: 0,
				},
			],
		})
		expect(
			book.volumes.flatMap((volume) =>
				volume.chapters.flatMap((chapter) => chapter.paragraphs),
			),
		).toEqual(['第一段。', '第二段。', '第三段。'])
	})

	test('offers a later volume cover at its first chapter without a paragraph', async () => {
		const book = await extract(
			heading('第一卷') +
				heading('第一章', 2) +
				p('正文。') +
				heading('第二卷') +
				drawing('cover') +
				heading('第二章', 2) +
				p('续卷正文。'),
			{
				'word/_rels/document.xml.rels': imageRelationships({
					cover: 'media/cover.png',
				}),
				'word/media/cover.png': 'cover image',
			},
		)
		expect(book.illustrations).toEqual([
			{ archivePath: 'word/media/cover.png', volume: 1, chapter: 0 },
		])
	})

	test.each([
		'../../outside.png',
		'https://example.test/a.png',
		'media\\a.png',
	])('rejects unsafe image relationship %s', async (target) => {
		await expect(
			extract(p('正文。') + drawing('one'), {
				'word/_rels/document.xml.rels': imageRelationships({ one: target }),
			}),
		).rejects.toMatchObject({ code: 'invalid_docx' })
	})

	test('ignores external, linked, missing and anchored drawings and reports empty illustrations', async () => {
		const book = await extract(
			p('正文。') +
				drawing('external') +
				drawing('missing') +
				drawing('linked').replace('r:embed', 'r:link') +
				drawing('anchor').replaceAll('wp:inline', 'wp:anchor'),
			{
				'word/_rels/document.xml.rels': imageRelationships({
					external: 'https://example.test/image.png',
					anchor: 'media/a.png',
				}).replace('Id="external"', 'Id="external" TargetMode="External"'),
				'word/media/a.png': 'image',
			},
		)
		expect(book).toMatchObject({ illustrations: [] })
	})
	test('resolves relationship targets with case different from their ZIP entries', async () => {
		const rels = (targets: Record<string, string>) =>
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(
				targets,
			)
				.map(
					([kind, target], i) =>
						`<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`,
				)
				.join('')}</Relationships>`
		const result = await extractDocx(
			await syntheticDocx({
				'_rels/.rels': rels({ officeDocument: 'Word/Main.XML' }),
				'word/_rels/main.xml.rels': rels({
					styles: 'Styles.XML',
					footnotes: 'FootNotes.XML',
					endnotes: 'EndNotes.XML',
				}),
				'word/main.xml': documentXml(
					p('关系标题', '<w:pStyle w:val="Custom"/>') +
						'<w:p><w:r><w:t>正文。</w:t><w:footnoteReference w:id="1"/><w:endnoteReference w:id="2"/></w:r></w:p>',
				),
				'word/styles.xml': `<w:styles xmlns:w="${namespace}"><w:style w:styleId="Custom"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
				'word/footnotes.xml': `<w:footnotes xmlns:w="${namespace}"><w:footnote w:id="1">${p('脚注。')}</w:footnote></w:footnotes>`,
				'word/endnotes.xml': `<w:endnotes xmlns:w="${namespace}"><w:endnote w:id="2">${p('尾注。')}</w:endnote></w:endnotes>`,
			}),
		)
		expect(compile(importExtractionSchema).check(result)).toBe(true)
		expect(result).toMatchObject({
			status: 'ready',
			book: {
				volumes: [
					{
						chapters: [
							{
								title: '关系标题',
								paragraphs: ['正文。'],
								notes: ['脚注。', '尾注。'],
							},
						],
					},
				],
			},
		})
	})
	test('reuses TXT cleanup for standalone watermark paragraphs without dropping URL dialogue', async () => {
		const dialogue = '他说：“打开 https://example.com 看看。”'
		const book = await extract(p(dialogue) + p('请收藏') + p('笔趣阁'))
		expect(book.volumes[0].chapters[0]).toEqual({
			title: '正文',
			paragraphs: [dialogue],
			notes: ['请收藏', '笔趣阁'],
		})
	})
	test('archives the entire annotation paragraph including manual line breaks', async () => {
		const book = await extract(
			p('故事。') +
				'<w:p><w:r><w:t>译者注：说明。</w:t><w:br/><w:t>附注续行。</w:t></w:r></w:p>',
		)
		expect(book.volumes[0].chapters[0]).toEqual({
			title: '正文',
			paragraphs: ['故事。'],
			notes: ['译者注：说明。\n附注续行。'],
		})
	})
	test('matches normalized OPC part names case-insensitively', async () => {
		const result = await extractDocx(
			await syntheticDocx({ 'WORD/DOCUMENT.XML': documentXml(p('正文。')) }),
		)
		expect(result).toMatchObject({
			status: 'ready',
			book: { volumes: [{ chapters: [{ paragraphs: ['正文。'] }] }] },
		})
	})
	test('retains nonbreaking hyphens and drops optional soft hyphens', async () => {
		const book = await extract(
			'<w:p><w:r><w:t>well</w:t><w:noBreakHyphen/><w:t>known</w:t><w:softHyphen/><w:t>word</w:t></w:r></w:p>',
		)
		expect(book.volumes[0].chapters[0].paragraphs).toEqual(['well‑knownword'])
	})
	test('does not collect text box paragraphs within images or drawings', async () => {
		const book = await extract(
			p('正文。') +
				['drawing', 'pict', 'txbxContent']
					.map(
						(tag) =>
							`<w:${tag}><w:txbxContent>${heading('不应作为标题')}${p('不应作为正文')}</w:txbxContent></w:${tag}>`,
					)
					.join('') +
				p('继续。'),
		)
		expect(book.volumes[0].chapters).toEqual([
			{ title: '正文', paragraphs: ['正文。', '继续。'], notes: [] },
		])
	})
	test('resolves relocated document, styles, footnotes and endnotes relationships', async () => {
		const rels = (targets: Record<string, string>) =>
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(
				targets,
			)
				.map(
					([kind, target], i) =>
						`<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`,
				)
				.join('')}</Relationships>`
		const result = await extractDocx(
			await syntheticDocx({
				'_rels/.rels': rels({ officeDocument: 'custom/main.xml' }),
				'custom/_rels/main.xml.rels': rels({
					styles: '../parts/styles.xml',
					footnotes: '../parts/foot.xml',
					endnotes: '../parts/end.xml',
				}),
				'custom/main.xml': documentXml(
					p('章', '<w:pStyle w:val="Custom"/>') +
						'<w:p><w:r><w:t>正文。</w:t><w:footnoteReference w:id="1"/><w:endnoteReference w:id="2"/></w:r></w:p>',
				),
				'parts/styles.xml': `<w:styles xmlns:w="${namespace}"><w:style w:styleId="Custom"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
				'parts/foot.xml': `<w:footnotes xmlns:w="${namespace}"><w:footnote w:id="1">${p('脚注。')}</w:footnote></w:footnotes>`,
				'parts/end.xml': `<w:endnotes xmlns:w="${namespace}"><w:endnote w:id="2">${p('尾注。')}</w:endnote></w:endnotes>`,
			}),
		)
		expect(compile(importExtractionSchema).check(result)).toBe(true)
		expect(result).toMatchObject({
			status: 'ready',
			book: {
				volumes: [
					{
						chapters: [
							{
								title: '章',
								paragraphs: ['正文。'],
								notes: ['脚注。', '尾注。'],
							},
						],
					},
				],
			},
		})
	})
	test('ignores historical paragraph and run properties', async () => {
		const old =
			'<w:pPrChange><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr></w:pPrChange>'
		const book = await extract(
			p('正文。', old) +
				'<w:p><w:r><w:rPr><w:rPrChange><w:rPr><w:outlineLvl w:val="0"/></w:rPr></w:rPrChange></w:rPr><w:t>继续。</w:t></w:r></w:p>',
		)
		expect(book.volumes[0].chapters).toEqual([
			{ title: '正文', paragraphs: ['正文。', '继续。'], notes: [] },
		])
	})
	test('retains dialogue containing a URL', async () => {
		const text = '他说：“打开 https://example.com 看看。”'
		const book = await extract(p(text))
		expect(book.volumes[0].chapters[0].paragraphs).toEqual([text])
		expect(book.volumes[0].chapters[0].notes).toEqual([])
	})
	test('maps heading levels to volumes/chapters and retains ordered run/table text', async () => {
		const book = await extract(
			p('引言。') +
				heading('卷一') +
				heading('章一', 2) +
				'<w:p><w:r><w:t>风 &amp; </w:t></w:r><w:r><w:t>雨。</w:t></w:r></w:p>' +
				'<w:tbl><w:tr><w:tc>' +
				p('表格正文。') +
				'</w:tc></w:tr></w:tbl>' +
				heading('章二', 2) +
				p('之后。') +
				heading('卷二') +
				heading('章三', 2) +
				p('结尾。'),
		)
		expect(book.volumes).toEqual([
			{
				title: '第一卷',
				chapters: [{ title: '前言', paragraphs: ['引言。'], notes: [] }],
			},
			{
				title: '卷一',
				chapters: [
					{ title: '章一', paragraphs: ['风 & 雨。', '表格正文。'], notes: [] },
					{ title: '章二', paragraphs: ['之后。'], notes: [] },
				],
			},
			{
				title: '卷二',
				chapters: [{ title: '章三', paragraphs: ['结尾。'], notes: [] }],
			},
		])
	})

	test('resolves inherited styles, localized names, direct outlines and body override', async () => {
		const styles = `<w:styles xmlns:w="${namespace}"><w:style w:styleId="Base"><w:name w:val="标题 1"/></w:style><w:style w:styleId="Custom"><w:basedOn w:val="Base"/></w:style></w:styles>`
		const book = await extract(
			p('一', '<w:pStyle w:val="Custom"/>') +
				p('正文。', '<w:pStyle w:val="Custom"/><w:outlineLvl w:val="9"/>') +
				p('二', '<w:outlineLvl w:val="0"/>') +
				p('下文。'),
			{ 'word/styles.xml': styles },
		)
		expect(
			book.volumes[0].chapters.map((c) => [c.title, c.paragraphs]),
		).toEqual([
			['一', ['正文。']],
			['二', ['下文。']],
		])
	})

	test('archives footnotes/endnotes in their referencing chapter and strips note markers', async () => {
		const note = (kind: string, id: number, text: string) =>
			`<w:${kind}s xmlns:w="${namespace}"><w:${kind} w:id="-1" w:type="separator">${p('忽略')}</w:${kind}><w:${kind} w:id="${id}">${p(text)}${p('续注。')}</w:${kind}></w:${kind}s>`
		const book = await extract(
			heading('第一章') +
				'<w:p><w:r><w:t>正文。</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
				p('译者注：旁注。') +
				p('www.example.com') +
				heading('第二章') +
				'<w:p><w:r><w:t>结局。</w:t><w:endnoteReference w:id="2"/></w:r></w:p>',
			{
				'word/footnotes.xml': note('footnote', 1, '脚注。'),
				'word/endnotes.xml': note('endnote', 2, '尾注。'),
			},
		)
		expect(book.volumes[0].chapters).toEqual([
			{
				title: '第一章',
				paragraphs: ['正文。'],
				notes: ['译者注：旁注。', 'www.example.com', '脚注。', '续注。'],
			},
			{ title: '第二章', paragraphs: ['结局。'], notes: ['尾注。', '续注。'] },
		])
	})

	test('plain document defaults to body; images and deleted text are not prose', async () => {
		const book = await extract(
			'<w:p><w:r><w:t>保留</w:t><w:tab/><w:t>文字</w:t><w:br/><w:t>换行。</w:t><w:drawing><w:t>图片</w:t></w:drawing></w:r><w:del><w:r><w:t>删除</w:t></w:r></w:del></w:p>',
		)
		expect(book.volumes[0].chapters[0]).toEqual({
			title: '正文',
			paragraphs: ['保留\t文字', '换行。'],
			notes: [],
		})
	})

	test('empty headings are omitted and note-only chapters are not lost', async () => {
		const book = await extract(
			heading('空章') +
				heading('注释章') +
				p('注：说明。') +
				heading('正文章') +
				p('故事。'),
		)
		expect(book.volumes[0].chapters).toEqual([
			{ title: '正文章', paragraphs: ['故事。'], notes: ['注：说明。'] },
		])
	})

	test.each(['', heading('空章'), p('注：只有注释。')])(
		'rejects documents without body text',
		async (body) => {
			await expect(extract(body)).rejects.toMatchObject({
				code: 'no_extractable_text',
			})
		},
	)

	test('rejects broken archives, missing parts, wrong XML and malformed XML with typed errors', async () => {
		for (const [bytes, code] of [
			[brokenDocx, 'invalid_docx'],
			[await syntheticDocx({ 'other.xml': '<x/>' }), 'missing_document'],
			[await syntheticDocx({ 'word/document.xml': '<html/>' }), 'invalid_docx'],
			[await syntheticDocx({ 'word/document.xml': '<bad>' }), 'invalid_xml'],
			[
				await syntheticDocx({ 'word/document.xml': '<!DOCTYPE x><x/>' }),
				'invalid_xml',
			],
		] as const) {
			await expect(extractDocx(bytes)).rejects.toBeInstanceOf(DocxImportError)
			await expect(extractDocx(bytes)).rejects.toMatchObject({ code })
		}
	})

	test('imports a synthetic local DOCX through the file entry point', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'novelive-docx-'))
		try {
			const file = join(dir, 'book.docx')
			await writeFile(
				file,
				await syntheticDocx({
					'word/document.xml': documentXml(heading('第一章') + p('离线正文。')),
				}),
			)
			expect(await importDocx(file)).toMatchObject({
				status: 'ready',
				book: {
					format: 'docx',
					volumes: [
						{ chapters: [{ title: '第一章', paragraphs: ['离线正文。'] }] },
					],
				},
			})
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})
