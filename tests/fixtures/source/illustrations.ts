import {
	TextReader,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipWriter,
} from '@zip.js/zip.js'
import sharp from 'sharp'
import { documentXml, paragraph, syntheticDocx } from './docx/synthetic'

export const drawing = (id: string) =>
	`<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${id}"/></wp:inline></w:drawing></w:r></w:p>`

export const imageRelationships = (targets: Record<string, string>) =>
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(
		targets,
	)
		.map(
			([id, target]) =>
				`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`,
		)
		.join('')}</Relationships>`

export async function illustratedBook(
	format: 'epub' | 'docx',
	count = 2,
	image?: Uint8Array,
) {
	const png =
		image ??
		(await sharp({
			create: { width: 24, height: 32, channels: 3, background: '#567890' },
		})
			.png()
			.toBuffer())
	const numbers = Array.from({ length: count }, (_, i) => i + 1)
	if (format === 'docx')
		return syntheticDocx({
			'word/document.xml': documentXml(
				paragraph('第一章 门', '<w:pStyle w:val="Heading1"/>') +
					paragraph('她推开门。') +
					numbers.map((i) => drawing(`r${i}`)).join(''),
			),
			'word/_rels/document.xml.rels': imageRelationships(
				Object.fromEntries(
					numbers.map((i) => [`r${i}`, `media/image${i}.png`]),
				),
			),
			...Object.fromEntries(
				numbers.map((i) => [`word/media/image${i}.png`, png]),
			),
		})
	const parts = {
		'META-INF/container.xml':
			'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
		'book.opf': `<package><metadata/><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/>${numbers.map((i) => `<item id="img${i}" href="images/image${i}.png" media-type="image/png"/>`).join('')}</manifest><spine><itemref idref="body"/></spine></package>`,
		'body.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章 门</h1><p>她推开门。</p>${numbers.map((i) => `<img src="images/image${i}.png"/>`).join('')}</body></html>`,
		...Object.fromEntries(numbers.map((i) => [`images/image${i}.png`, png])),
	}
	const zip = new ZipWriter(new Uint8ArrayWriter())
	for (const [name, data] of Object.entries(parts))
		await zip.add(
			name,
			typeof data === 'string'
				? new TextReader(data)
				: new Uint8ArrayReader(data),
		)
	return zip.close()
}
