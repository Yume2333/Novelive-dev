export type SentenceKind = 'dialogue' | 'inner' | 'narration' | 'caption'

export interface SentenceLine {
	lineNumber: number
	lineId: string | undefined
	kind: SentenceKind
	speaker: string | undefined
	displayAs: string | undefined
	text: string
	click: boolean
	indent: string
	prefix: string
	tail: string
	raw: string
}

const captionPrefix = /^@caption(?:\s+|$)/
const textPrefix =
	/^(?:([a-z0-9][a-z0-9_-]*)(?:\s+(\(inner\)))?(?:\s+as\s+([^:]+?))?)?:(?: |\t)?/
const idSuffix = /(?:^|\s)#([0-9a-f]{4})$/
const waitSuffix = /(?:^|\s)wait$/
const contSuffix = /(?:^|\s)cont$/

function parseRawSentence(
	raw: string,
	lineNumber: number,
): SentenceLine | undefined {
	const indent = raw.match(/^\s*/)?.[0] ?? ''
	const trimmed = raw.slice(indent.length).trimEnd()
	if (!trimmed || trimmed.startsWith('```')) return undefined
	if (/^(?:scene|source)(?:\s|$)/.test(trimmed)) return undefined

	let kind: SentenceKind
	let speaker: string | undefined
	let displayAs: string | undefined
	let prefixLen: number
	let rest: string

	const caption = captionPrefix.exec(trimmed)
	if (caption) {
		kind = 'caption'
		prefixLen = caption[0].length
		rest = trimmed.slice(prefixLen)
	} else if (trimmed.startsWith('@')) {
		return undefined
	} else {
		const prefix = textPrefix.exec(trimmed)
		if (!prefix) return undefined
		const [, spk, inner, alias] = prefix
		kind = inner ? 'inner' : spk ? 'dialogue' : 'narration'
		speaker = spk
		displayAs = alias?.trim() || undefined
		prefixLen = prefix[0].length
		rest = trimmed.slice(prefixLen)
	}

	const idMatch = idSuffix.exec(rest)
	const lineId = idMatch?.[1]
	const withoutId = idMatch ? rest.slice(0, idMatch.index).trimEnd() : rest
	const idTail = idMatch ? rest.slice(idMatch.index) : ''

	const marker = kind === 'caption' ? waitSuffix : contSuffix
	const markerMatch = marker.exec(withoutId)
	const text = markerMatch
		? withoutId.slice(0, markerMatch.index).trimEnd()
		: withoutId
	const markerTail = markerMatch ? withoutId.slice(markerMatch.index) : ''

	return {
		lineNumber,
		lineId,
		kind,
		speaker,
		displayAs,
		text,
		click: kind === 'caption' ? !!markerMatch : !markerMatch,
		indent,
		prefix: trimmed.slice(0, prefixLen),
		tail: `${markerTail}${idTail}`,
		raw,
	}
}

export function parseSentenceLines(nvs: string): SentenceLine[] {
	const out: SentenceLine[] = []
	for (const [index, raw] of nvs.split(/\r\n?|\n/).entries()) {
		const parsed = parseRawSentence(raw, index + 1)
		if (parsed) out.push(parsed)
	}
	return out
}

export function updateSentenceLine(
	nvs: string,
	lineNumber: number,
	patch: { text?: string; displayAs?: string },
): string {
	const parts = nvs.split(/(\r\n?|\n)/)
	const lineIndex = (lineNumber - 1) * 2
	const raw = parts[lineIndex]
	if (raw === undefined) return nvs
	const parsed = parseRawSentence(raw, lineNumber)
	if (!parsed) return nvs

	let prefix = parsed.prefix
	if (patch.displayAs !== undefined && parsed.speaker) {
		const sanitizedAlias = patch.displayAs.replace(/[:\r\n]+/g, '').trim()
		const colonSpace = parsed.prefix.match(/:\s*$/)?.[0] ?? ': '
		prefix = `${parsed.speaker}${parsed.kind === 'inner' ? ' (inner)' : ''}${
			sanitizedAlias ? ` as ${sanitizedAlias}` : ''
		}${colonSpace}`
	}

	const nextText = (patch.text ?? parsed.text).replace(/[\r\n]+/g, ' ')
	const hasTailLeadingSpace = parsed.tail.length > 0 && /^\s/.test(parsed.tail)
	const separator =
		!nextText || hasTailLeadingSpace || parsed.tail.length === 0 ? '' : ' '
	parts[lineIndex] =
		`${parsed.indent}${prefix}${nextText}${separator}${parsed.tail}`
	return parts.join('')
}

export type RichSeg =
	| { kind: 'text'; text: string }
	| { kind: 'mark'; mark: string; text: string }
	| { kind: 'ruby'; text: string; reading: string }
	| { kind: 'wait'; seconds: string }
	| { kind: 'speed'; factor: string; text: string }

export function parseRich(src: string): RichSeg[] {
	const segs: RichSeg[] = []
	let buf = ''
	let i = 0
	const flush = () => {
		if (buf) {
			segs.push({ kind: 'text', text: buf })
			buf = ''
		}
	}
	while (i < src.length) {
		if (src[i] !== '{') {
			buf += src[i++]
			continue
		}
		if (src[i + 1] === '{') {
			buf += '{'
			i += 2
			continue
		}
		const close = src.indexOf('}', i)
		if (close === -1) {
			buf += src[i++]
			continue
		}
		const tag = src.slice(i + 1, close).trim()
		const sp = tag.indexOf(' ')
		const name = sp === -1 ? tag : tag.slice(0, sp)
		const arg = sp === -1 ? '' : tag.slice(sp + 1).trim()
		if (!name || name.startsWith('/')) {
			buf += src.slice(i, close + 1)
			i = close + 1
			continue
		}
		if (name === 'wait') {
			flush()
			segs.push({ kind: 'wait', seconds: arg || '0.5' })
			i = close + 1
			continue
		}
		const closeTag = `{/${name}}`
		const end = src.indexOf(closeTag, close + 1)
		if (end === -1) {
			buf += src.slice(i, close + 1)
			i = close + 1
			continue
		}
		flush()
		const inner = src.slice(close + 1, end)
		if (name === 'ruby') segs.push({ kind: 'ruby', text: inner, reading: arg })
		else if (name === 'speed')
			segs.push({ kind: 'speed', factor: arg || '1', text: inner })
		else segs.push({ kind: 'mark', mark: name, text: inner })
		i = end + closeTag.length
	}
	flush()
	return segs
}

export interface MarkSpan {
	mark: string
	param?: string
	inner: string
	start: number
	end: number
}

export function scanMarks(src: string): MarkSpan[] {
	const out: MarkSpan[] = []
	let i = 0
	while (i < src.length) {
		if (src[i] !== '{') {
			i++
			continue
		}
		if (src[i + 1] === '{') {
			i += 2
			continue
		}
		const close = src.indexOf('}', i)
		if (close === -1) break
		const tag = src.slice(i + 1, close).trim()
		const sp = tag.indexOf(' ')
		const name = sp === -1 ? tag : tag.slice(0, sp)
		const arg = sp === -1 ? '' : tag.slice(sp + 1).trim()
		if (name === 'wait') {
			out.push({
				mark: 'wait',
				param: arg || undefined,
				inner: '',
				start: i,
				end: close + 1,
			})
			i = close + 1
			continue
		}
		if (!name || name.startsWith('/')) {
			i = close + 1
			continue
		}
		const closeTag = `{/${name}}`
		const end = src.indexOf(closeTag, close + 1)
		if (end === -1) {
			i = close + 1
			continue
		}
		out.push({
			mark: name,
			param: arg || undefined,
			inner: src.slice(close + 1, end),
			start: i,
			end: end + closeTag.length,
		})
		i = close + 1
	}
	return out.sort((a, b) => a.start - b.start)
}

export function rewriteMarkSpan(
	src: string,
	span: MarkSpan,
	nextMark: string,
	nextParam: string | undefined,
	nextInner: string,
): string {
	const cleanParam = nextParam?.trim()
	const tag =
		nextMark === 'wait'
			? `{wait ${cleanParam || '0.5'}}`
			: `{${nextMark}${cleanParam ? ` ${cleanParam}` : ''}}${nextInner}{/${nextMark}}`
	return src.slice(0, span.start) + tag + src.slice(span.end)
}

export function removeMarkSpan(src: string, span: MarkSpan): string {
	return src.slice(0, span.start) + span.inner + src.slice(span.end)
}
