import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'
import { SaxesParser } from 'saxes'
import type { ExtractedBook, ImportExtraction } from '../../contract/import'
import { parseTxt } from '../txt/structure'

const wordNamespaces = new Set([
	'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
	'http://purl.oclc.org/ooxml/wordprocessingml/main',
])

export class DocxImportError extends Error {
	override name = 'DocxImportError'
	constructor(
		public readonly code:
			| 'invalid_docx'
			| 'missing_document'
			| 'invalid_xml'
			| 'no_extractable_text',
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options)
	}
}

interface Element {
	name: string
	uri: string
	attrs: Record<string, string>
	children: (Element | string)[]
}

function xml(source: string): Element {
	const root: Element = { name: '', uri: '', attrs: {}, children: [] }
	const stack = [root]
	const parser = new SaxesParser({ xmlns: true })
	parser.on('doctype', () => {
		throw new Error('DOCTYPE is not supported')
	})
	parser.on('opentag', (tag) => {
		const node: Element = {
			name: tag.local,
			uri: tag.uri,
			attrs: Object.fromEntries(
				Object.values(tag.attributes).map((attr) => [attr.local, attr.value]),
			),
			children: [],
		}
		stack.at(-1)?.children.push(node)
		stack.push(node)
	})
	parser.on('text', (text) => stack.at(-1)?.children.push(text))
	parser.on('cdata', (text) => stack.at(-1)?.children.push(text))
	parser.on('closetag', () => stack.pop())
	try {
		parser.write(source).close()
	} catch (cause) {
		throw new DocxImportError('invalid_xml', 'DOCX contains invalid XML', {
			cause,
		})
	}
	return root
}

function* elements(node: Element, name: string): Generator<Element> {
	for (const child of node.children) {
		if (typeof child === 'string') continue
		if (
			wordNamespaces.has(child.uri) &&
			['drawing', 'pict', 'txbxContent'].includes(child.name)
		)
			continue
		if (wordNamespaces.has(child.uri) && child.name.endsWith('PrChange'))
			continue
		if (wordNamespaces.has(child.uri) && child.name === name) yield child
		yield* elements(child, name)
	}
}

function bodyText(node: Element): string {
	if (!wordNamespaces.has(node.uri)) return ''
	if (['del', 'drawing', 'pict', 'instrText'].includes(node.name)) return ''
	if (node.name === 'tab') return '\t'
	if (node.name === 'noBreakHyphen') return '‑'
	if (node.name === 'softHyphen') return ''
	if (['br', 'cr'].includes(node.name)) return '\n'
	return node.children
		.map((child) =>
			typeof child === 'string'
				? node.name === 't'
					? child
					: ''
				: bodyText(child),
		)
		.join('')
}

function relationshipTarget(source: string, kind: string, part: string) {
	const root = xml(source)
	const relationships = root.children.flatMap((node) =>
		typeof node === 'string' ? [] : node.children,
	)
	for (const rel of relationships) {
		if (
			typeof rel === 'string' ||
			rel.name !== 'Relationship' ||
			![
				'http://schemas.openxmlformats.org/package/2006/relationships',
				'http://purl.oclc.org/ooxml/package/relationships',
			].includes(rel.uri) ||
			!rel.attrs.Type?.endsWith(`/${kind}`) ||
			rel.attrs.TargetMode === 'External'
		)
			continue
		const target = posix.normalize(
			posix.join(posix.dirname(part), rel.attrs.Target),
		)
		if (
			target.startsWith('../') ||
			target.includes('\\') ||
			/^[a-z]+:/i.test(target)
		)
			throw new DocxImportError(
				'invalid_docx',
				'Invalid DOCX relationship target',
			)
		return rel.attrs.Target.startsWith('/') ? rel.attrs.Target.slice(1) : target
	}
}

/** Extracts DOCX bytes without writing archive entries to disk. */
export async function extractDocx(
	source: Uint8Array,
): Promise<ImportExtraction> {
	const zip = new ZipReader(new Uint8ArrayReader(source))
	try {
		const entries = await zip.getEntries()
		const read = async (path: string) => {
			const entry = entries.find((entry) => entry.filename === path)
			return entry && !entry.directory
				? entry.getData(new TextWriter(), { checkSignature: true })
				: undefined
		}
		const packageRels = await read('_rels/.rels')
		const mainPart =
			(packageRels && relationshipTarget(packageRels, 'officeDocument', '')) ||
			'word/document.xml'
		const partRels = await read(
			posix.join(
				posix.dirname(mainPart),
				'_rels',
				`${posix.basename(mainPart)}.rels`,
			),
		)
		const relatedPart = (kind: string, fallback: string) =>
			(partRels && relationshipTarget(partRels, kind, mainPart)) || fallback
		const document = await read(mainPart)
		if (document === undefined)
			throw new DocxImportError(
				'missing_document',
				`DOCX is missing ${mainPart}`,
			)
		const tree = xml(document)
		const body = [...elements(tree, 'body')][0]
		if (!body)
			throw new DocxImportError('invalid_docx', 'Not a Word DOCX document')
		const styles = new Map<string, Element>()
		const styleXml = await read(relatedPart('styles', 'word/styles.xml'))
		if (styleXml)
			for (const style of elements(xml(styleXml), 'style'))
				styles.set(style.attrs.styleId, style)
		const outline = (node: Element) => {
			const value = [...elements(node, 'outlineLvl')][0]?.attrs.val
			return value !== undefined && /^[0-9]$/.test(value)
				? Number(value)
				: undefined
		}
		const styleLevel = (
			id: string,
			seen = new Set<string>(),
		): number | undefined => {
			if (seen.has(id)) return
			seen.add(id)
			const style = styles.get(id)
			const name = style && [...elements(style, 'name')][0]?.attrs.val
			const heading = /^(?:heading|标题)\s*([1-9])$/i.exec(name ?? id)
			const level = style && outline(style)
			if (level !== undefined) return level
			if (heading) return Number(heading[1]) - 1
			const base = style && [...elements(style, 'basedOn')][0]?.attrs.val
			return base ? styleLevel(base, seen) : undefined
		}
		const notes = new Map<string, string[]>()
		for (const kind of ['footnote', 'endnote']) {
			const source = await read(relatedPart(`${kind}s`, `word/${kind}s.xml`))
			if (!source) continue
			for (const note of elements(xml(source), kind)) {
				if (note.attrs.type && note.attrs.type !== 'normal') continue
				notes.set(
					`${kind}:${note.attrs.id}`,
					[...elements(note, 'p')]
						.map(bodyText)
						.map((s) => s.trim())
						.filter(Boolean),
				)
			}
		}
		const paragraphs = [...elements(body, 'p')].map((p) => {
			const id = [...elements(p, 'pStyle')][0]?.attrs.val
			return {
				text: bodyText(p).trim(),
				level: outline(p) ?? (id ? styleLevel(id) : undefined),
				notes: ['footnote', 'endnote'].flatMap((kind) =>
					[...elements(p, `${kind}Reference`)].flatMap(
						(ref) => notes.get(`${kind}:${ref.attrs.id}`) ?? [],
					),
				),
			}
		})
		const levels = [
			...new Set(
				paragraphs
					.filter((p) => p.text && p.level !== undefined && p.level < 9)
					.map((p) => p.level as number),
			),
		].sort((a, b) => a - b)
		const volumes: ExtractedBook['volumes'] = []
		let volume: ExtractedBook['volumes'][number] = {
			title: '第一卷',
			chapters: [],
		}
		let title = levels.length ? '前言' : '正文'
		let lines: string[] = []
		let archived: string[] = []
		let pendingNotes: string[] = []
		const flush = () => {
			const protectedLines = new Map<string, string>()
			const input = lines.map((line, index) => {
				if (
					!/(?:https?:\/\/|www\.)\S+/i.test(line) ||
					/^(?:https?:\/\/|www\.)\S+$/i.test(line)
				)
					return line
				const token = `DOCXURLPARAGRAPH${index}`
				protectedLines.set(token, line)
				return token
			})
			const parsed = parseTxt(input.join('\n\n'), { rules: [] }).volumes[0]
				.chapters
			for (const [index, chapter] of parsed.entries()) {
				const paragraphs = chapter.paragraphs.map(
					(p) => protectedLines.get(p.text) ?? p.text,
				)
				const notes = [...chapter.notes, ...(index === 0 ? archived : [])]
				if (!paragraphs.length) {
					pendingNotes.push(...notes)
					continue
				}
				volume.chapters.push({
					title: title + (parsed.length > 1 ? `（${index + 1}）` : ''),
					paragraphs,
					notes: [...pendingNotes, ...notes],
				})
				pendingNotes = []
			}
			lines = []
			archived = []
		}
		for (const p of paragraphs) {
			if (p.text && p.level !== undefined && p.level < 9) {
				flush()
				if (levels.length > 1 && p.level === levels[0]) {
					if (volume.chapters.length) volumes.push(volume)
					volume = { title: p.text, chapters: [] }
					title = '前言'
				} else title = p.text
			} else if (p.text) lines.push(p.text)
			archived.push(...p.notes)
		}
		flush()
		if (volume.chapters.length) volumes.push(volume)
		if (!volumes.length)
			throw new DocxImportError(
				'no_extractable_text',
				'DOCX has no extractable body text',
			)
		volumes
			.at(-1)
			?.chapters.at(-1)
			?.notes.push(...pendingNotes)
		return { status: 'ready', book: { format: 'docx', metadata: {}, volumes } }
	} catch (cause) {
		if (cause instanceof DocxImportError) throw cause
		throw new DocxImportError(
			'invalid_docx',
			'Invalid or corrupt DOCX archive',
			{ cause },
		)
	} finally {
		await zip.close()
	}
}

export async function importDocx(
	sourcePath: string,
): Promise<ImportExtraction> {
	return extractDocx(await readFile(sourcePath))
}
