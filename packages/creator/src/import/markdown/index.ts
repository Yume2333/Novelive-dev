import type {
	FootnoteDefinition,
	Nodes,
	PhrasingContent,
	RootContent,
} from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import type { ExtractedBook } from '../../contract/import'
import { headingRules } from '../txt'

export type MarkdownBook = Exclude<ExtractedBook, { format: 'epub' }> & {
	format: 'markdown'
}
type Volume = MarkdownBook['volumes'][number]
type Chapter = Volume['chapters'][number]

export class MarkdownImportError extends Error {}

// A section under one of these headings is front or back matter, not story text.
const matterHeading =
	/^(?:目录|目錄|目次|版权|版權|版权页|版權頁|版权信息|版權資訊|版权声明|版權聲明|contents|table of contents|copyright)$/i
const annotation =
	/^(?:[【[]?(?:注释|注釋|脚注|腳註|附注|附註|译者注|譯者註|作者注|编者注|編者註|版权|版權|著作权|著作權)|[【[]?[注註]\s*[:：】\]])/
const sentenceEnd = /[。！？…」』”）]$/
const wide =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef“”‘’…—]/u
// Marks a hard line break inside extracted text.
const hard = '\u0000'

const yamlLine = /^(?:#|\s|-(?:\s|$)|[^\s#:-][^:]*:(?:\s|$))/
const yamlKey = /^[^\s#:-][^:]*:(?:\s|$)/

function scalar(raw: string, rest: string[]) {
	if (/^[|>][-+0-9]*(?:\s+#.*)?$/.test(raw)) {
		const lines: string[] = []
		for (const line of rest) {
			if (line && !/^\s/.test(line)) break
			lines.push(line.trim())
		}
		return lines.filter(Boolean).join(' ')
	}
	const single = raw.match(/^'((?:[^']|'')*)'/)
	if (single) return single[1].replaceAll("''", "'")
	const double = raw.match(/^"((?:[^"\\]|\\.)*)"/)
	if (double) {
		try {
			return JSON.parse(`"${double[1]}"`) as string
		} catch {
			return double[1]
		}
	}
	return raw.replace(/\s+#.*$/, '')
}

// A leading `---` block is YAML front matter only when every line reads as
// YAML; otherwise it is a thematic break and the text stays in the body.
function frontMatter(text: string) {
	const metadata: MarkdownBook['metadata'] = {}
	const block = text.match(
		/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/,
	)
	const lines = block?.[1].split('\n') ?? []
	const filled = lines.filter((line) => line.trim())
	if (
		!block ||
		!filled.some((line) => yamlKey.test(line)) ||
		!filled.every((line) => yamlLine.test(line))
	)
		return { body: text, metadata }
	for (const [i, line] of lines.entries()) {
		const field = line.match(/^(title|lang|language):[ \t]*(.+?)[ \t]*$/)
		if (!field) continue
		const value = scalar(field[2], lines.slice(i + 1)).trim()
		if (!value) continue
		if (field[1] === 'title') metadata.title = value
		else metadata.language = value
	}
	return { body: text.slice(block[0].length), metadata }
}

const stripHtml = (html: string) =>
	html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<[^>]*>/g, '')

function phrasing(nodes: PhrasingContent[], refs: string[] = []): string {
	return nodes
		.map((node) => {
			switch (node.type) {
				case 'text':
				case 'inlineCode':
					return node.value
				case 'break':
					return hard
				case 'html':
					return stripHtml(node.value)
				case 'footnoteReference':
					refs.push(node.identifier)
					return ''
				case 'image':
				case 'imageReference':
					return ''
				default:
					return 'children' in node ? phrasing(node.children, refs) : ''
			}
		})
		.join('')
}

// Soft breaks join wrapped lines. A hard break, or a soft break after a CJK
// sentence end, starts a new paragraph, as in line-per-paragraph novel text.
// An annotation line is always a paragraph of its own.
function paragraphs(text: string) {
	const out: string[] = []
	for (const part of text.split(hard)) {
		let current = ''
		for (const raw of part.split('\n')) {
			const line = raw.trim()
			if (!line) continue
			const alone = annotation.test(line)
			if (current && (alone || sentenceEnd.test(current))) {
				out.push(current)
				current = ''
			}
			current +=
				!current || wide.test(current.at(-1) ?? '') || wide.test(line[0])
					? line
					: ` ${line}`
			if (alone) {
				out.push(current)
				current = ''
			}
		}
		if (current) out.push(current)
	}
	return out
}

function headingKind(title: string) {
	for (const rule of headingRules) {
		rule.pattern.lastIndex = 0
		if (rule.enable && rule.pattern.test(title)) return rule.kind
	}
	return 'other'
}

export function extractMarkdown(bytes: Uint8Array): {
	status: 'ready'
	book: MarkdownBook
} {
	let source: string
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		throw new MarkdownImportError('Markdown must be UTF-8')
	}
	const { body, metadata } = frontMatter(source.replace(/\r\n?/g, '\n'))
	const tree = fromMarkdown(body, {
		extensions: [gfmFootnote()],
		mdastExtensions: [gfmFootnoteFromMarkdown()],
	})

	const definitions = new Map<string, FootnoteDefinition>()
	const referenced = new Set<string>()
	const visit = (node: Nodes) => {
		if (node.type === 'footnoteDefinition')
			definitions.set(node.identifier, node)
		if (node.type === 'footnoteReference') referenced.add(node.identifier)
		if ('children' in node) for (const child of node.children) visit(child)
	}
	visit(tree)

	// Heading levels are relative: the shallowest structural level holds
	// volumes and the next one chapters, unless the shallowest already reads
	// as chapters. Deeper headings stay in the chapter body.
	const headings = tree.children.flatMap((node, index) =>
		node.type === 'heading'
			? [{ index, depth: node.depth, title: phrasing(node.children).trim() }]
			: [],
	)
	const matter = new Set<number>()
	for (const [i, heading] of headings.entries()) {
		if (
			!matterHeading.test(heading.title) &&
			headingKind(heading.title) !== 'exclude'
		)
			continue
		matter.add(heading.index)
		for (const next of headings.slice(i + 1)) {
			if (next.depth <= heading.depth) break
			matter.add(next.index)
		}
	}
	let structural = headings.filter(
		(heading) => heading.title && !matter.has(heading.index),
	)
	const levels = () => [...new Set(structural.map((h) => h.depth))].sort()
	let depths = levels()
	let titleIndex = -1
	const top = structural.filter((h) => h.depth === depths[0])
	if (
		depths.length > 1 &&
		top.length === 1 &&
		top[0] === structural[0] &&
		headingKind(top[0].title) === 'other' &&
		(metadata.title ?? top[0].title) === top[0].title
	) {
		titleIndex = top[0].index
		metadata.title = top[0].title
		structural = structural.slice(1)
		depths = levels()
	}
	const shallow = structural.filter((h) => h.depth === depths[0])
	const kinds = shallow.map((h) => headingKind(h.title))
	const shallowAreChapters =
		kinds.filter((kind) => kind === 'chapter').length * 2 > kinds.length &&
		!kinds.includes('volume')
	const volumeDepth =
		depths.length > 1 && !shallowAreChapters ? depths[0] : undefined
	const chapterDepth = volumeDepth === undefined ? depths[0] : depths[1]

	const volumes: Volume[] = []
	const implicit = new Set<Chapter>()
	let volume: Volume = { title: '第一卷', chapters: [] }
	let section = { title: '', paragraphs: [] as string[], notes: [] as string[] }
	let carried: string[] = []
	let inMatter = false
	let volumeHeadings = 0

	// A heading with no body text is dropped; its notes move to the next chapter.
	const flush = () => {
		const notes = [...carried, ...section.notes]
		carried = section.paragraphs.length ? [] : notes
		if (!section.paragraphs.length) return
		const chapter = {
			title: section.title || (structural.length ? '前言' : '正文'),
			paragraphs: section.paragraphs,
			notes,
		}
		if (!section.title) implicit.add(chapter)
		volume.chapters.push(chapter)
	}
	const closeVolume = () => {
		const [only] = volume.chapters
		if (!only) return
		if (volumeHeadings && volume.chapters.length === 1 && implicit.has(only))
			only.title = volume.title
		volumes.push(volume)
	}
	const note = (text: string) => {
		if (text) section.notes.push(text)
	}
	const add = (text: string, refs: string[], asNote: boolean) => {
		for (const paragraph of paragraphs(text)) {
			if (asNote || inMatter || annotation.test(paragraph)) note(paragraph)
			else section.paragraphs.push(paragraph)
		}
		attach(refs)
	}
	function attach(refs: string[]) {
		for (const id of refs) {
			const definition = definitions.get(id)
			if (!definition) continue
			definitions.delete(id)
			for (const child of definition.children) block(child, true)
		}
	}
	function block(node: RootContent, asNote = false) {
		const refs: string[] = []
		switch (node.type) {
			case 'paragraph':
			case 'heading':
				return add(phrasing(node.children, refs), refs, asNote)
			case 'code':
				return add(node.value.replaceAll('\n', hard), refs, asNote)
			case 'html':
				return add(stripHtml(node.value).replaceAll('\n', hard), refs, asNote)
			case 'footnoteDefinition':
				// Referenced notes follow their first reference; others stay here.
				if (!referenced.has(node.identifier)) {
					definitions.delete(node.identifier)
					for (const child of node.children) block(child, true)
				}
				return
			case 'blockquote':
			case 'list':
			case 'listItem':
				for (const child of node.children) block(child as RootContent, asNote)
				return
			default:
				return
		}
	}

	for (const [index, node] of tree.children.entries()) {
		if (node.type !== 'heading') {
			block(node)
			continue
		}
		const refs: string[] = []
		const title = phrasing(node.children, refs).trim()
		if (index === titleIndex) {
			attach(refs)
			continue
		}
		if (matter.has(index)) {
			inMatter = true
			note(title)
			attach(refs)
			continue
		}
		inMatter = false
		if (node.depth > chapterDepth || !title) {
			block(node)
			continue
		}
		flush()
		section = { title: '', paragraphs: [], notes: [] }
		if (node.depth !== volumeDepth) section.title = title
		else if (volumeHeadings++ === 0 && !volume.chapters.length)
			volume.title = title
		else {
			if (volumeHeadings === 1) volume.title = '前言'
			closeVolume()
			volume = { title, chapters: [] }
		}
		attach(refs)
	}
	for (const definition of definitions.values())
		for (const child of definition.children) block(child, true)
	flush()
	closeVolume()
	const last = volumes.at(-1)?.chapters.at(-1)
	if (!last) throw new MarkdownImportError('Markdown has no body text')
	last.notes.push(...carried)
	return { status: 'ready', book: { format: 'markdown', metadata, volumes } }
}
