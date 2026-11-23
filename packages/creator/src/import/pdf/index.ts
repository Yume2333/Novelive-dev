import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ImportExtraction } from '../../contract/import'
import { headingRules, parseTxt } from '../txt/structure'

const require = createRequire(import.meta.url)
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))

interface Line {
	text: string
	x: number
	y: number
	height: number
	page: number
	spacing: number
	left: number
	zone?: 'top' | 'bottom'
}

function lineSpacing(lines: Line[]) {
	const gaps = lines
		.slice(1)
		.map((line, i) => Math.abs(line.y - lines[i].y))
		.filter((gap) => gap > 0)
		.sort((a, b) => a - b)
	return (
		gaps[Math.floor((gaps.length - 1) / 2)] ?? (lines[0]?.height ?? 12) * 1.5
	)
}

function pageLayout(lines: Line[]) {
	const spacing = lineSpacing(lines.length >= 4 ? lines.slice(1, -1) : lines)
	if (lines.length > 1) {
		if (Math.abs(lines[0].y - lines[1].y) > spacing * 1.5) lines[0].zone = 'top'
		const last = lines.length - 1
		if (Math.abs(lines[last].y - lines[last - 1].y) > spacing * 1.5)
			lines[last].zone = 'bottom'
	}
	const body = lines.filter((line) => !line.zone)
	const left = Math.min(...body.map((line) => line.x))
	const bodySpacing = lineSpacing(body)
	return lines.map((line) => ({ ...line, left, spacing: bodySpacing }))
}

const heading = (text: string) =>
	headingRules.some(
		(rule) => rule.enable && rule.kind !== 'exclude' && rule.pattern.test(text),
	)

function mergeLines(lines: Line[]) {
	const paragraphs: string[] = []
	const notes = lines.map((line) =>
		parseTxt(line.text).volumes.some((volume) =>
			volume.chapters.some((chapter) => chapter.notes.length > 0),
		),
	)
	const noteBlocks = lines.map(
		(line, i) =>
			notes[i] &&
			parseTxt(`${line.text}\nPDF continuation probe`).volumes.some((volume) =>
				volume.chapters.some((chapter) =>
					chapter.notes.includes('PDF continuation probe'),
				),
			),
	)
	let noteParagraph = false
	for (const [i, line] of lines.entries()) {
		const previous = lines[i - 1]
		const boundary =
			!previous ||
			notes[i] ||
			(notes[i - 1] && !noteBlocks[i - 1]) ||
			(noteParagraph && previous.page !== line.page) ||
			heading(line.text) ||
			heading(previous.text) ||
			/[。！？…」』”".!?][\s）)\]’']*$/u.test(previous.text) ||
			line.x - line.left > line.height * 0.8 ||
			(previous.page === line.page &&
				Math.abs(previous.y - line.y) > line.spacing * 1.5)
		if (boundary) {
			paragraphs.push(line.text)
			noteParagraph = notes[i]
		} else {
			const last = paragraphs.length - 1
			if (/[A-Za-z]-$/u.test(paragraphs[last]) && /^[a-z]/u.test(line.text))
				paragraphs[last] = paragraphs[last].slice(0, -1) + line.text
			else
				paragraphs[last] +=
					/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(
						paragraphs[last],
					) ||
					/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
						line.text,
					)
						? line.text
						: ` ${line.text}`
		}
	}
	return paragraphs.join('\n\n')
}

function stripPageNumbers(lines: Line[]) {
	const edges = lines.filter((line) => line.zone)
	return lines.filter((line) => {
		if (!edges.includes(line)) return true
		if (/^(?:[-–—]\s*\d+\s*[-–—]|第\s*\d+\s*[页頁])$/u.test(line.text))
			return false
		if (!/^\d+$/u.test(line.text)) return true
		return (
			edges.filter(
				(other) =>
					/^\d+$/u.test(other.text) &&
					other.zone === line.zone &&
					Number(other.text) - other.page === Number(line.text) - line.page,
			).length < 3
		)
	})
}

function stripRunningEdges(lines: Line[]) {
	const tops = new Map<number, Line>()
	const bottoms = new Map<number, Line>()
	for (const line of lines) {
		if (line.zone === 'top') tops.set(line.page, line)
		if (line.zone === 'bottom') bottoms.set(line.page, line)
	}
	return lines.filter((line) => {
		for (const edges of [tops, bottoms]) {
			if (edges.get(line.page) !== line) continue
			const previous = edges.get(line.page - 1)?.text === line.text
			const next = edges.get(line.page + 1)?.text === line.text
			if (
				(previous || next) &&
				!(edges === tops && !previous && heading(line.text))
			)
				return false
		}
		return true
	})
}

export async function extractPdf(bytes: Uint8Array): Promise<ImportExtraction> {
	const task = getDocument({
		data: Uint8Array.from(bytes),
		cMapUrl: join(pdfRoot, 'cmaps') + sep,
		standardFontDataUrl: join(pdfRoot, 'standard_fonts') + sep,
		useWorkerFetch: false,
	})
	try {
		const document = await task.promise
		const lines: Line[] = []
		for (let number = 1; number <= document.numPages; number++) {
			const page = await document.getPage(number)
			try {
				const { items } = await page.getTextContent()
				const pageLines: Line[] = []
				let current: Line | undefined
				for (const item of items) {
					if (!('str' in item)) continue
					if (
						!current ||
						Math.abs(current.y - item.transform[5]) > item.height * 0.5
					) {
						current = {
							text: '',
							x: item.transform[4],
							y: item.transform[5],
							height: item.height,
							page: number,
							spacing: 0,
							left: 0,
						}
						pageLines.push(current)
					}
					current.text += item.str
					if (item.hasEOL) current = undefined
				}
				const nonempty = pageLines.filter((line) => {
					line.text = line.text.trim()
					return line.text.length
				})
				lines.push(...pageLayout(nonempty))
			} finally {
				page.cleanup()
			}
		}
		const text = mergeLines(stripRunningEdges(stripPageNumbers(lines)))
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
