import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'

export const namespace =
	'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const paragraph = (text: string, properties = '') =>
	`<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`
export const documentXml = (body: string) =>
	`<w:document xmlns:w="${namespace}"><w:body>${body}</w:body></w:document>`

export async function syntheticDocx(parts: Record<string, string>) {
	const zip = new ZipWriter(new Uint8ArrayWriter())
	for (const [name, text] of Object.entries(parts))
		await zip.add(name, new TextReader(text))
	return zip.close()
}

export const brokenDocx = new TextEncoder().encode('not a ZIP or DOCX file')
