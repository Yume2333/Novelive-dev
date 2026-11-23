import { readFile } from 'node:fs/promises'
import { compile } from '@earendil-works/pi-schema'
import { importExtractionSchema } from '../../../../packages/creator/src/contract/import'
import { extractMarkdown } from '../../../../packages/creator/src/import/markdown'

const [path] = process.argv.slice(2)
if (!path) throw new Error('Usage: extract <file.md>')
const result = extractMarkdown(await readFile(path))
if (!compile(importExtractionSchema).check(result))
	throw new Error('Extraction does not match the import contract')
const { metadata, volumes } = result.book
console.log(`${metadata.title ?? '(untitled)'} [${metadata.language ?? '?'}]`)
for (const volume of volumes) {
	console.log(volume.title)
	for (const chapter of volume.chapters)
		console.log(
			`  ${chapter.title}: ${chapter.paragraphs.length} paragraphs, ${chapter.notes.length} notes`,
		)
}
