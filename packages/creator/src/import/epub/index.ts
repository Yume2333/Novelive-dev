import { posix } from 'node:path'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import type { ExtractedBook, ImportExtraction } from '../../contract/import'
import { all, children, type Element, text, xml } from './xml'

export type EpubBook = Extract<ExtractedBook, { format: 'epub' }>
type Location = EpubBook['illustrations'][number]
interface Block {
	text: string
	heading: boolean
	image?: string
}
interface Document {
	path: string
	blocks: Block[]
	anchors: Map<string, number>
}
interface Marker {
	doc: number
	block: number
	title: string
	volume?: string
}

function archivePath(path: string) {
	if (
		!path ||
		path.split('/').some((part) => !part || part === '.' || part === '..') ||
		/[:\\]/.test(path) ||
		Array.from(path).some((char) => char.charCodeAt(0) < 32)
	)
		throw new Error('Unsafe EPUB archive path')
	return path
}

function resolve(base: string, href: string) {
	if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href))
		throw new Error('External EPUB reference is not supported')
	const [file, fragment = ''] = href.split('#')
	const decoded = decodeURIComponent(file)
	if (/[?#\\]/.test(decoded)) throw new Error('Unsafe EPUB reference')
	return {
		path: archivePath(file ? posix.join(posix.dirname(base), decoded) : base),
		fragment: decodeURIComponent(fragment),
	}
}

async function archive(bytes: Uint8Array) {
	if (bytes.length > 64 * 1024 * 1024)
		throw new Error('EPUB input limit exceeded')
	const reader = new ZipReader(new Uint8ArrayReader(bytes))
	const files = new Map<string, Uint8Array>()
	try {
		const entries = await reader.getEntries()
		if (entries.length > 4096) throw new Error('EPUB entry limit exceeded')
		let total = 0
		for (const entry of entries) {
			if (entry.directory) continue
			const path = archivePath(entry.filename)
			total += entry.uncompressedSize
			if (
				entry.uncompressedSize > 16 * 1024 * 1024 ||
				total > 128 * 1024 * 1024
			)
				throw new Error('EPUB expansion limit exceeded')
			if (entry.encrypted || files.has(path))
				throw new Error('Encrypted or duplicate EPUB entry')
			files.set(path, await entry.getData(new Uint8ArrayWriter()))
		}
	} finally {
		await reader.close()
	}
	return files
}

function document(path: string, root: Element): Document {
	const blocks: Block[] = []
	const anchors = new Map<string, number>()
	const visit = (node: Element) => {
		if (
			['head', 'script', 'style', 'nav', 'aside'].includes(node.name) ||
			/(?:^|\s)(?:footnote|endnote|noteref)(?:\s|$)/.test(
				node.attrs['epub:type'] ?? node.attrs.role ?? '',
			)
		)
			return
		if (node.attrs.id) anchors.set(node.attrs.id, blocks.length)
		if (node.name === 'img' || node.name === 'image') {
			const href = node.attrs.src ?? node.attrs.href ?? node.attrs['xlink:href']
			if (href)
				blocks.push({
					text: '',
					heading: false,
					image: resolve(path, href).path,
				})
			return
		}
		if (
			['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.name) ||
			(['div', 'li', 'blockquote', 'body'].includes(node.name) &&
				!children(node).some((child) =>
					[
						'p',
						'div',
						'li',
						'blockquote',
						'section',
						'article',
						'h1',
						'h2',
						'h3',
						'h4',
						'h5',
						'h6',
					].includes(child.name),
				))
		) {
			for (const element of node.children
				.filter((child) => typeof child !== 'string')
				.flatMap((child) => [
					child,
					...all(child, 'span'),
					...all(child, 'a'),
				])) {
				if (element.attrs.id) anchors.set(element.attrs.id, blocks.length)
			}
			const plain = (element: Element): string =>
				element.children
					.map((child) => {
						if (typeof child === 'string') return child
						if (
							['aside', 'script', 'style'].includes(child.name) ||
							/(?:note|noteref)/.test(child.attrs['epub:type'] ?? '')
						)
							return ''
						return child.name === 'br' ? '\n' : plain(child)
					})
					.join('')
			for (const paragraph of plain(node)
				.split(/\n+/)
				.map((value) => value.replace(/\s+/g, ' ').trim())
				.filter(Boolean))
				blocks.push({ text: paragraph, heading: /^h[1-6]$/.test(node.name) })
			for (const image of [...all(node, 'img'), ...all(node, 'image')])
				visit(image)
			return
		}
		let inline: Element['children'] = []
		const flush = () => {
			if (inline.length) visit({ name: 'p', attrs: {}, children: inline })
			inline = []
		}
		for (const child of node.children) {
			if (
				typeof child === 'string' ||
				[
					'a',
					'span',
					'em',
					'strong',
					'b',
					'i',
					'ruby',
					'rt',
					'br',
					'img',
					'image',
				].includes(child.name)
			) {
				inline.push(child)
			} else {
				flush()
				visit(child)
			}
		}
		flush()
	}
	visit(all(root, 'body')[0] ?? root)
	return { path, blocks, anchors }
}

export interface EpubExtraction {
	status: 'ready'
	book: EpubBook
	images: Map<string, Uint8Array>
}

export async function extractEpub(
	bytes: Uint8Array,
): Promise<EpubExtraction & ImportExtraction> {
	const files = await archive(bytes)
	const read = (path: string) => {
		const data = files.get(path)
		if (!data) throw new Error(`Missing EPUB entry: ${path}`)
		return xml(new TextDecoder('utf-8', { fatal: true }).decode(data))
	}
	const rootfile = all(read('META-INF/container.xml'), 'rootfile')[0]?.attrs[
		'full-path'
	]
	if (!rootfile) throw new Error('Missing EPUB rootfile')
	const opfPath = archivePath(rootfile)
	const opf = read(opfPath)
	const manifest: (Record<string, string> & { path: string })[] = all(
		opf,
		'item',
	).map((item) => ({
		...item.attrs,
		path: resolve(opfPath, item.attrs.href).path,
	}))
	const docs = all(opf, 'itemref')
		.filter((ref) => ref.attrs.linear !== 'no')
		.map((ref) => {
			const item = manifest.find((item) => item.id === ref.attrs.idref)
			if (!item) throw new Error('Missing EPUB spine item')
			return document(item.path, read(item.path))
		})
	if (!docs.some((doc) => doc.blocks.some((block) => block.text)))
		throw new Error('EPUB has no extractable text')
	const locate = (
		base: string,
		href: string,
		title: string,
		volume?: string,
	): Marker | undefined => {
		try {
			const target = resolve(base, href)
			const doc = docs.findIndex((doc) => doc.path === target.path)
			if (doc < 0) return
			const block = target.fragment ? docs[doc].anchors.get(target.fragment) : 0
			if (block === undefined) return
			return { doc, block, title: title || target.path, volume }
		} catch {
			return
		}
	}
	const navigation = (kind: 'nav' | 'ncx'): Marker[] => {
		const item =
			kind === 'nav'
				? manifest.find((item) => item.properties?.split(/\s+/).includes('nav'))
				: (manifest.find(
						(item) => item.id === all(opf, 'spine')[0]?.attrs.toc,
					) ??
					manifest.find(
						(item) => item['media-type'] === 'application/x-dtbncx+xml',
					))
		if (!item || !files.has(item.path)) return []
		try {
			const root = read(item.path)
			const markers: Marker[] = []
			const walk = (node: Element, volume?: string) => {
				if (node.name === (kind === 'nav' ? 'li' : 'navPoint')) {
					const label =
						kind === 'nav'
							? children(node).find((child) =>
									['a', 'span'].includes(child.name),
								)
							: children(node).find((child) => child.name === 'navLabel')
					const href =
						kind === 'nav'
							? label?.attrs.href
							: children(node).find((child) => child.name === 'content')?.attrs
									.src
					const title = label ? text(label) : ''
					const nested =
						all(node, kind === 'nav' ? 'li' : 'navPoint').length > 0
					if (href && !nested) {
						const marker = locate(item.path, href, title, volume)
						if (marker) markers.push(marker)
					}
					if (nested && title) volume = title
				}
				for (const child of children(node)) walk(child, volume)
			}
			if (kind === 'nav') {
				const toc = all(root, 'nav').find((node) =>
					(node.attrs['epub:type'] ?? '').split(/\s+/).includes('toc'),
				)
				if (toc) walk(toc)
			} else for (const map of all(root, 'navMap')) walk(map)
			return markers
		} catch {
			return []
		}
	}
	let method: EpubBook['navigation'] = 'nav'
	let markers = navigation('nav')
	if (!markers.length) {
		method = 'ncx'
		markers = navigation('ncx')
	}
	if (!markers.length) {
		method = 'heading'
		markers = docs.flatMap((doc, index) =>
			doc.blocks.flatMap((block, offset) =>
				block.heading ? [{ doc: index, block: offset, title: block.text }] : [],
			),
		)
	}
	if (!markers.length) {
		method = 'spine'
		markers = docs.map((doc, index) => ({
			doc: index,
			block: 0,
			title: doc.path,
		}))
	}
	markers.sort((a, b) => a.doc - b.doc || a.block - b.block)
	markers = markers.filter(
		(marker, index) =>
			!index ||
			marker.doc !== markers[index - 1].doc ||
			marker.block !== markers[index - 1].block,
	)
	if (markers[0].doc || markers[0].block)
		markers.unshift({ doc: 0, block: 0, title: '前言' })
	const book: EpubBook = {
		format: 'epub',
		navigation: method,
		metadata: {},
		volumes: [],
		illustrations: [],
	}
	const title = all(opf, 'title')[0]
	const language = all(opf, 'language')[0]
	if (title && text(title)) book.metadata.title = text(title)
	if (language && text(language)) book.metadata.language = text(language)
	const images = new Map<string, Uint8Array>()
	for (const [index, marker] of markers.entries()) {
		const next = markers[index + 1]
		const blocks = docs.flatMap((doc, docIndex) =>
			doc.blocks.filter(
				(_, block) =>
					(docIndex > marker.doc ||
						(docIndex === marker.doc && block >= marker.block)) &&
					(!next ||
						docIndex < next.doc ||
						(docIndex === next.doc && block < next.block)),
			),
		)
		const paragraphs = blocks
			.filter((block) => block.text)
			.map((block) => block.text)
		if (!paragraphs.length) continue
		const volumeTitle = marker.volume ?? '正文'
		if (book.volumes.at(-1)?.title !== volumeTitle)
			book.volumes.push({ title: volumeTitle, chapters: [] })
		const volume = book.volumes.length - 1
		const chapter = book.volumes[volume].chapters.length
		book.volumes[volume].chapters.push({
			title: marker.title,
			paragraphs,
			notes: [],
		})
		let paragraph = -1
		for (const block of blocks) {
			if (block.text) paragraph++
			if (!block.image) continue
			const data = files.get(block.image)
			if (!data) throw new Error(`Missing EPUB image: ${block.image}`)
			images.set(block.image, data)
			const location: Location = {
				archivePath: block.image,
				volume,
				chapter,
				paragraph: Math.max(0, paragraph),
			}
			book.illustrations.push(location)
		}
	}
	for (const item of manifest) {
		if (!item['media-type']?.startsWith('image/') || images.has(item.path))
			continue
		const data = files.get(item.path)
		if (!data) throw new Error(`Missing EPUB image: ${item.path}`)
		images.set(item.path, data)
		book.illustrations.push({ archivePath: item.path, volume: 0, chapter: 0 })
	}
	return { status: 'ready', book, images }
}
