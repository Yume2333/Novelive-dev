export const MAX_CHAPTER_CHARS = 20000
export interface HeadingRule {
	name: string
	pattern: RegExp
	kind: 'chapter' | 'volume' | 'exclude'
	example: string
	enable: boolean
	auxiliary?: boolean
	minimumHits?: number
}
const number =
	'[0-9０-９零〇一二三四五六七八九十百千万兩两壹贰叁肆伍陆柒捌玖拾佰仟]+'
export const headingRules: HeadingRule[] = [
	{
		name: 'toc',
		pattern: /(?:[.…·]{2,}|\s{3,})\s*\d+\s*$/,
		kind: 'exclude',
		example: '第一章 …… 12',
		enable: true,
	},
	{
		name: 'volume',
		pattern: new RegExp(`^(?:第\\s*${number}\\s*[卷部本]|[上中下][卷部]).*$`),
		kind: 'volume',
		example: '第一卷 风起',
		enable: true,
	},
	{
		name: 'numbered',
		pattern: new RegExp(`^第\\s*${number}\\s*[章回节節折](?:.*)$`),
		kind: 'chapter',
		example: '第一章 门',
		enable: true,
	},
	{
		name: 'english',
		pattern: /^(?:chapter|ch\.)\s+\d+(?:\b.*)$/i,
		kind: 'chapter',
		example: 'Chapter 1',
		enable: true,
	},
	{
		name: 'digits',
		pattern: /^\d+(?:[.、:：\s]+[^。！？!?]*|$)$/,
		kind: 'chapter',
		example: '1 门',
		enable: true,
		minimumHits: 3,
	},
	{
		name: 'auxiliary',
		pattern:
			/^(?:序章|序言|前言|楔子|番外|后记|後記|尾声|尾聲|终章|終章|凡例)(?:[\s：:、（(].*|[一二三四五六七八九十\d]+.*|$)/,
		kind: 'chapter',
		example: '序章',
		enable: true,
		auxiliary: true,
	},
]

export interface TxtFinding {
	code: string
	line: number
	title: string
	note: string
}
export interface TxtChapter {
	chapterId: string
	title: string
	line: number
	paragraphs: { id: string; text: string }[]
	notes: string[]
}
export interface TxtVolume {
	volumeId: string
	title: string
	chapters: TxtChapter[]
}
export interface TxtStructure {
	volumes: TxtVolume[]
	findings: TxtFinding[]
	mainRule?: string
}
const matches = (pattern: RegExp, text: string) => {
	pattern.lastIndex = 0
	return pattern.test(text)
}
const watermark =
	/(?:https?:\/\/|www\.|请收藏|請收藏|(?:笔趣阁|筆趣閣|起点中文网|起點中文網)|^(?:[\w-]+\.)+(?:com|net|org|cn|io)(?:\/\S*)?$|^[=*_─━—\-~～·◆◇※\s]{3,}$)/i
const annotation =
	/^(?:[【[]?(?:注释|注釋|脚注|腳註|附注|附註|版权|版權|著作权|著作權|译者注|譯者註|作者注|注\s*[:：]|註\s*[:：])|[①②③④⑤⑥⑦⑧⑨⑩]|\[\d+\]\s)/

function ordinal(title: string) {
	const token =
		title.match(/^(?:chapter|ch\.|volume)\s+(\d+)\b/i)?.[1] ??
		title.match(
			new RegExp(
				`^(?:第\\s*)?(${number})(?:\\s*[章回节節折卷部本]|[.、:：\\s]|$)`,
			),
		)?.[1]
	if (!token) return
	const normalized = token
		.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
		.replace(
			/[零〇兩两壹贰叁肆伍陆柒捌玖拾佰仟]/g,
			(char) =>
				(
					({
						零: '〇',
						〇: '〇',
						兩: '二',
						两: '二',
						壹: '一',
						贰: '二',
						叁: '三',
						肆: '四',
						伍: '五',
						陆: '六',
						柒: '七',
						捌: '八',
						玖: '九',
						拾: '十',
						佰: '百',
						仟: '千',
					}) as Record<string, string>
				)[char],
		)
	if (/^\d+$/.test(normalized)) return Number(normalized)
	if (/^[〇一二三四五六七八九]+$/.test(normalized))
		return Number(
			[...normalized]
				.map((char) => '〇一二三四五六七八九'.indexOf(char))
				.join(''),
		)
	let total = 0
	let section = 0
	let digit = 0
	for (const char of normalized) {
		const unit = (
			{ 十: 10, 百: 100, 千: 1000, 万: 10000 } as Record<string, number>
		)[char]
		if (unit === 10000) {
			total += (section + digit) * unit
			section = 0
			digit = 0
		} else if (unit) {
			section += (digit || 1) * unit
			digit = 0
		} else
			digit =
				char === '两' || char === '兩'
					? 2
					: Math.max('〇一二三四五六七八九'.indexOf(char), 0)
	}
	return total + section + digit
}

export function parseTxt(
	text: string,
	options: { rules?: HeadingRule[]; cleanupRules?: RegExp[] } = {},
): TxtStructure {
	const lines = text
		.replace(/^\ufeff/, '')
		.replace(/\r\n?/g, '\n')
		.split('\n')
	const rules = (options.rules ?? headingRules).filter((rule) => rule.enable)
	const excluded = (line: string) =>
		rules.some((rule) => rule.kind === 'exclude' && matches(rule.pattern, line))
	const hits = (rule: HeadingRule) =>
		lines.flatMap((line, i) => {
			const title = line.trim()
			return title.length <= 100 &&
				!excluded(title) &&
				matches(rule.pattern, title)
				? [i]
				: []
		})
	const ranked = rules
		.filter((rule) => rule.kind === 'chapter' && !rule.auxiliary)
		.map((rule) => ({ rule, hits: hits(rule) }))
		.filter(({ rule, hits }) => hits.length >= (rule.minimumHits ?? 1))
		.sort((a, b) => b.hits.length - a.hits.length)
	const main = ranked[0]
	const chapterLines = new Set(main?.hits ?? [])
	for (const rule of rules.filter((rule) => rule.auxiliary))
		for (const line of hits(rule)) chapterLines.add(line)
	const volumeLines = new Set(
		rules.filter((rule) => rule.kind === 'volume').flatMap(hits),
	)
	const findings: TxtFinding[] = []
	const finding = (code: string, index: number, note: string) =>
		findings.push({
			code,
			line: index + 1,
			title: lines[index]?.trim() ?? '',
			note,
		})
	if (chapterLines.size === 0 && volumeLines.size >= 2) {
		for (const line of volumeLines) chapterLines.add(line)
		volumeLines.clear()
		finding(
			'volumes-as-chapters',
			[...chapterLines][0],
			'卷标题降为章：未发现更细章节',
		)
	}
	for (let i = 0; i < lines.length; i++) {
		const title = lines[i].trim()
		if (
			!chapterLines.has(i) &&
			!volumeLines.has(i) &&
			title.length <= 100 &&
			!excluded(title) &&
			/^(?:第.{1,12}[章回节節折卷部本]|chapter\b|[序楔终終]章|番外)/i.test(
				title,
			)
		)
			finding('fuzzy-heading', i, '疑似标题，保留在正文待核对')
	}
	const volumes: TxtVolume[] = [
		{ volumeId: 'v0001', title: '第一卷', chapters: [] },
	]
	let volume = volumes[0]
	let current = {
		title: chapterLines.size || volumeLines.size ? '前言' : '正文',
		line: 1,
		body: [] as string[],
	}
	let chapterCount = 0
	const flush = (force = false) => {
		const paragraphs: string[] = []
		const notes: string[] = []
		let noteBlock = false
		for (const raw of current.body) {
			const line = raw.trim()
			if (!line) {
				noteBlock = false
				continue
			}
			if (annotation.test(line)) noteBlock = true
			if (
				noteBlock ||
				excluded(line) ||
				watermark.test(line) ||
				options.cleanupRules?.some((pattern) => matches(pattern, line))
			)
				notes.push(line)
			else paragraphs.push(line)
		}
		if (!force && !paragraphs.length && !notes.length) return
		const chunks: string[][] = [[]]
		let size = 0
		for (const paragraph of paragraphs) {
			if (size && size + 2 + paragraph.length > MAX_CHAPTER_CHARS) {
				chunks.push([])
				size = 0
			}
			chunks[chunks.length - 1].push(paragraph)
			size += paragraph.length + (size ? 2 : 0)
			if (paragraph.length > MAX_CHAPTER_CHARS)
				finding(
					'oversized-paragraph',
					current.line - 1,
					'单段超过最大章长度，保持段落完整待人工处理',
				)
		}
		if (chunks.length > 1)
			finding('split-chapter', current.line - 1, '长章按段落边界拆分')
		for (const [index, chunk] of chunks.entries()) {
			const chapterId = `ch${String(++chapterCount).padStart(4, '0')}`
			volume.chapters.push({
				chapterId,
				title: current.title + (chunks.length > 1 ? `（${index + 1}）` : ''),
				line: current.line,
				paragraphs: chunk.map((text, i) => ({
					id: `p${String(i + 1).padStart(4, '0')}`,
					text,
				})),
				notes: index === 0 ? notes : [],
			})
		}
		if (!paragraphs.length)
			finding('empty-chapter', current.line - 1, '本章无正文')
	}
	let explicitChapter = false
	const seenChapters = new Set<string>()
	const seenVolumes = new Set<string>()
	let volumeHeadings = 0
	let previousVolume: number | undefined
	let previousChapter: number | undefined
	const checkOrder = (
		kind: 'volume' | 'chapter',
		title: string,
		line: number,
	) => {
		const value = ordinal(title)
		if (value === undefined) return
		const previous = kind === 'volume' ? previousVolume : previousChapter
		if (previous !== undefined && value !== previous + 1)
			finding(`${kind}-sequence`, line, `编号异常：${previous} → ${value}`)
		if (kind === 'volume') previousVolume = value
		else previousChapter = value
	}
	for (let i = 0; i < lines.length; i++) {
		const title = lines[i].trim()
		if (volumeLines.has(i)) {
			flush(explicitChapter)
			checkOrder('volume', title, i)
			if (seenVolumes.has(title)) finding('duplicate-volume', i, '重复卷标题')
			seenVolumes.add(title)
			if (volumeHeadings++ === 0 && !volume.chapters.length)
				volume.title = title
			else {
				if (volumeHeadings === 1) volume.title = '前言'
				if (!volume.chapters.length)
					finding('empty-volume', i - 1, '上一卷无章节')
				volume = {
					volumeId: `v${String(volumes.length + 1).padStart(4, '0')}`,
					title,
					chapters: [],
				}
				volumes.push(volume)
			}
			current = { title: '前言', line: i + 2, body: [] }
			explicitChapter = false
			seenChapters.clear()
			previousChapter = undefined
		} else if (chapterLines.has(i)) {
			flush(explicitChapter)
			checkOrder('chapter', title, i)
			if (seenChapters.has(title))
				finding('duplicate-chapter', i, '本卷重复章标题')
			seenChapters.add(title)
			current = { title, line: i + 1, body: [] }
			explicitChapter = true
		} else current.body.push(lines[i])
	}
	flush(explicitChapter || !volumes.some((item) => item.chapters.length))
	if (!volume.chapters.length)
		finding('empty-volume', lines.length - 1, '末卷无章节')
	return { volumes, findings, mainRule: main?.rule.name }
}
