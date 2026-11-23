import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
	TextReader,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipWriter,
} from '@zip.js/zip.js'
import sharp from 'sharp'
import {
	documentXml,
	paragraph,
	syntheticDocx,
} from '../../source/docx/synthetic'
import { drawing, imageRelationships } from '../../source/illustrations'

const body = ['Unfinished prose', 'Body continues.', 'Last body sentence.']

export async function writeFormatBooks(root: string) {
	const png = await sharp({
		create: { width: 24, height: 32, channels: 3, background: '#567890' },
	})
		.png()
		.toBuffer()
	const files: Record<string, string | Uint8Array> = {
		txt: `Chapter 1\n\n${body[0]}\n\n[1] Translator note\n\n${body[1]}\n\nwww.example.com\n\n${body[2]}\n`,
		md: `# Chapter 1\n\n${body[0]}[^1]\n\n${body[1]}\n\n${body[2]}\n\n[^1]: Translator note\n`,
		docx: await syntheticDocx({
			'word/document.xml': documentXml(
				paragraph('Chapter 1', '<w:pStyle w:val="Heading1"/>') +
					body.map((line) => paragraph(line)).join('') +
					paragraph('注：Translator note') +
					drawing('r1') +
					drawing('r2'),
			),
			'word/_rels/document.xml.rels': imageRelationships({
				r1: 'media/one.png',
				r2: 'media/two.png',
			}),
			'word/media/one.png': png,
			'word/media/two.png': png,
		}),
		pdf: await readFile(new URL('../../source/pdf/notes.pdf', import.meta.url)),
	}
	for (const nav of [true, false]) {
		const zip = new ZipWriter(new Uint8ArrayWriter())
		for (const [name, data] of Object.entries({
			'META-INF/container.xml':
				'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
			'book.opf': `<package><metadata/><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/><item id="img" href="image.png" media-type="image/png"/>${nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}</manifest><spine><itemref idref="body"/></spine></package>`,
			'nav.xhtml':
				'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="body.xhtml">Chapter 1</a></li></ol></nav></body></html>',
			'body.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><h1>Chapter 1</h1>${body.map((line) => `<p>${line}</p>`).join('')}<aside epub:type="footnote"><p>Translator note</p></aside><img src="image.png"/><img src="image.png"/></body></html>`,
			'image.png': png,
		}))
			await zip.add(
				name,
				typeof data === 'string'
					? new TextReader(data)
					: new Uint8ArrayReader(data),
			)
		files[nav ? 'epub-nav' : 'epub-fallback'] = await zip.close()
	}
	for (const [name, bytes] of Object.entries(files))
		await writeFile(
			join(root, `${name}.${name.startsWith('epub') ? 'epub' : name}`),
			bytes,
		)
	await writeFile(
		join(root, 'scan.pdf'),
		await readFile(new URL('../../source/pdf/image-only.pdf', import.meta.url)),
	)
	return Object.keys(files).map((name) => ({
		name,
		path: join(root, `${name}.${name.startsWith('epub') ? 'epub' : name}`),
	}))
}
