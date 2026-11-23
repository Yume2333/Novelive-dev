import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ImportExtraction } from '../../contract/import'
import { parseTxt } from '../txt/structure'

const require = createRequire(import.meta.url)
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))

export async function extractPdf(bytes: Uint8Array): Promise<ImportExtraction> {
	const task = getDocument({
		data: Uint8Array.from(bytes),
		cMapUrl: join(pdfRoot, 'cmaps') + sep,
		standardFontDataUrl: join(pdfRoot, 'standard_fonts') + sep,
		useWorkerFetch: false,
	})
	try {
		const document = await task.promise
		const pages: string[] = []
		for (let number = 1; number <= document.numPages; number++) {
			const page = await document.getPage(number)
			try {
				const { items } = await page.getTextContent()
				let text = ''
				for (const item of items) {
					if (!('str' in item)) continue
					text += item.str
					if (item.hasEOL) text += '\n'
				}
				pages.push(text)
			} finally {
				page.cleanup()
			}
		}
		const text = pages.join('\n')
		if (!text.trim())
			return {
				status: 'unsupported',
				format: 'pdf',
				reason: 'no_extractable_text',
			}
		const { info } = await document.getMetadata()
		const title = (info as { Title?: string }).Title?.trim()
		const structure = parseTxt(text)
		const volumes = structure.volumes.flatMap((volume) => {
			const chapters = volume.chapters
				.filter((chapter) => chapter.paragraphs.length)
				.map((chapter) => ({
					title: chapter.title,
					paragraphs: chapter.paragraphs.map(({ text }) => text),
					notes: chapter.notes,
				}))
			return chapters.length ? [{ title: volume.title, chapters }] : []
		})
		if (!volumes.length) throw new Error('PDF 无可导入的正文')
		return {
			status: 'ready',
			book: { format: 'pdf', metadata: title ? { title } : {}, volumes },
		}
	} finally {
		await task.destroy()
	}
}
