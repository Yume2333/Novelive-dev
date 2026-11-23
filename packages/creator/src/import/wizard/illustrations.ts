import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import sharp from 'sharp'
import type { ExtractedBook } from '../../contract/import'
import type { Project } from '../../project'

export interface WizardIllustration {
	id: string
	volume: number
	chapter: number
	paragraph?: number
	preview: string
}

export interface StoredIllustration extends WizardIllustration {
	cachePath: string
}

export async function importIllustrations(
	project: Project,
	bytes: Uint8Array,
	book: ExtractedBook,
): Promise<StoredIllustration[]> {
	if (book.format !== 'epub' && book.format !== 'docx') return []
	const zip = new ZipReader(new Uint8ArrayReader(bytes))
	try {
		const entries = await zip.getEntries()
		const candidates: StoredIllustration[] = []
		for (const [index, location] of book.illustrations.slice(0, 40).entries()) {
			const entry = entries.find(
				(entry) => entry.filename === location.archivePath && !entry.directory,
			)
			if (
				!entry ||
				entry.directory ||
				entry.uncompressedSize > 20 * 1024 * 1024
			)
				continue
			const source = await entry.getData(new Uint8ArrayWriter(), {
				checkSignature: true,
			})
			let image: Buffer
			let preview: Buffer
			try {
				image = await sharp(source, { limitInputPixels: 16_000_000 })
					.rotate()
					.resize({
						width: 2048,
						height: 2048,
						fit: 'inside',
						withoutEnlargement: true,
					})
					.png()
					.toBuffer()
				preview = await sharp(image)
					.resize({
						width: 192,
						height: 192,
						fit: 'inside',
						withoutEnlargement: true,
					})
					.png()
					.toBuffer()
			} catch {
				continue
			}
			if (image.length > 16 * 1024 * 1024 || preview.length > 256 * 1024)
				continue
			const id = `illustration-${index + 1}`
			const cachePath = `source/imports/illustrations/${id}.png`
			await project.writeFile(cachePath, image)
			candidates.push({
				id,
				volume: location.volume,
				chapter: location.chapter,
				...(location.paragraph === undefined
					? {}
					: { paragraph: location.paragraph }),
				cachePath,
				preview: `data:image/png;base64,${preview.toString('base64')}`,
			})
		}
		return candidates
	} finally {
		await zip.close()
	}
}
