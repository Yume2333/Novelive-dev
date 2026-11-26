export const encodings = [
	'utf-8',
	'gb18030',
	'big5',
	'shift_jis',
	'utf-16le',
	'utf-16be',
] as const
export type TxtEncoding = (typeof encodings)[number]
export interface EncodingCandidate {
	encoding: TxtEncoding
	text: string
	score: number
	preview: string
}
export class TxtEncodingError extends Error {
	/**
	 * `txt_decoding_failed` when a user-selected encoding fails the quality
	 * gates; `txt_encoding_unknown` when detection finds no viable encoding.
	 */
	constructor(
		readonly code: 'txt_encoding_unknown' | 'txt_decoding_failed',
		readonly candidates: EncodingCandidate[],
	) {
		super(
			candidates.length
				? 'Ambiguous TXT encoding; select a candidate'
				: code === 'txt_decoding_failed'
					? 'The selected TXT encoding failed the quality gates'
					: 'No supported TXT encoding passed the quality gates',
		)
	}
}

function decode(bytes: Uint8Array, encoding: TxtEncoding) {
	return new TextDecoder(encoding, { fatal: true }).decode(bytes)
}
function quality(text: string) {
	return [...text].every((char) => {
		const code = char.codePointAt(0) as number
		return (
			(code >= 32 || char === '\n' || char === '\r' || char === '\t') &&
			!(code >= 127 && code <= 159) &&
			code !== 65533
		)
	})
}
function candidate(
	bytes: Uint8Array,
	encoding: TxtEncoding,
	shapeGate = true,
): EncodingCandidate | undefined {
	try {
		const text = decode(bytes, encoding)
		if (!quality(text)) return
		const chars = [...text.replace(/\s/g, '')]
		const count = (pattern: RegExp) =>
			chars.filter((char) => pattern.test(char)).length /
			Math.max(chars.length, 1)
		const han = count(/\p{Script=Han}/u)
		const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/u)
		const common = count(
			/[的一是在不了有和人这這中大为為上个個国國我以要他时時来來用们們生到作地于於出就分对對成会會可主发發年动動同工也能下过過子说說产產种種面而方后後多定行学學法所民得经經之进進着著等部度家电電力里裡如水化高自二理起小物现現实實加量都两兩体體制机機当當使点點从從业業本去把性好应應开開它合还還因由其些然前外天政四日那社义義事平形相全表间間样樣与與关關各重线線内內数數正心反你明看原又么麼利比或但质質气氣第向道命此变變条條只没沒结結解问問意建月公无無系军軍很情者最立代想已通并並提直题題程展五果料象员員位入常文总總次品式活设設及管特件长長求老头頭基流路级級少图圖山统統接知较較将將组組见見计計别別她手角期根论論运運指区區强強放决決被做必战戰先回则則任取据據处理處世车車价價望声聲走海门門风風]/u,
		)
		let score = han * 2 + kana * 4 + common * 5
		if (encoding === 'utf-8') score += 2
		// Han-only mojibake without prose punctuation is not persuasive evidence.
		if (
			shapeGate &&
			han > 0.5 &&
			common < 0.12 &&
			!/[。，！？「」『』、]/u.test(text)
		)
			return
		if (
			shapeGate &&
			encoding !== 'utf-8' &&
			han + kana < 0.1 &&
			chars.some((char) => char.charCodeAt(0) > 127)
		)
			return
		return {
			encoding,
			text,
			score,
			preview: text.split(/\r?\n/).slice(0, 5).join('\n').slice(0, 300),
		}
	} catch {
		return
	}
}

export function detectTxtEncoding(bytes: Uint8Array): EncodingCandidate[] {
	let bom: TxtEncoding | undefined
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = 'utf-8'
	else if (bytes[0] === 0xff && bytes[1] === 0xfe) bom = 'utf-16le'
	else if (bytes[0] === 0xfe && bytes[1] === 0xff) bom = 'utf-16be'
	if (bom) {
		const result = candidate(bytes, bom, false)
		return result ? [result] : []
	}
	if (bytes.every((byte) => byte > 0 && byte < 128)) {
		const result = candidate(bytes, 'utf-8')
		return result ? [result] : []
	}
	if (bytes.length % 2 === 0 && bytes.length > 0) {
		const sniffed: EncodingCandidate[] = []
		const pairs = bytes.length / 2
		for (const encoding of ['utf-16le', 'utf-16be'] as const) {
			const high = encoding === 'utf-16le' ? 1 : 0
			let asciiPairs = 0
			let punctuationPairs = 0
			let newlinePairs = 0
			for (let i = 0; i < bytes.length; i += 2) {
				if (
					bytes[i + high] === 0 &&
					bytes[i + 1 - high] > 0 &&
					bytes[i + 1 - high] < 128
				)
					asciiPairs++
				const unit = bytes[i + high] * 256 + bytes[i + 1 - high]
				if (unit === 10 || unit === 13) newlinePairs++
				if ([0x3002, 0xff0c, 0xff01, 0xff1f, 0x300c, 0x300d].includes(unit))
					punctuationPairs++
			}
			if (
				(asciiPairs > 0 && asciiPairs / pairs >= 0.02) ||
				punctuationPairs / pairs >= 0.05
			) {
				const result = candidate(bytes, encoding, false)
				if (result) {
					result.score +=
						(2 * asciiPairs + 4 * (newlinePairs + punctuationPairs)) / pairs
					sniffed.push(result)
				}
			}
		}
		sniffed.sort((a, b) => b.score - a.score)
		if (sniffed.length)
			return sniffed.length === 1 || sniffed[0].score - sniffed[1].score >= 1.5
				? sniffed.slice(0, 1)
				: sniffed
	}
	const candidates = encodings
		.flatMap((encoding) => {
			const result = candidate(bytes, encoding)
			return result ? [result] : []
		})
		.sort((a, b) => b.score - a.score)
	if (
		candidates.length < 2 ||
		(candidates[0].score - candidates[1].score >= 1.5 &&
			(candidates[0].encoding === 'utf-8' ||
				candidates[0].text.trim().length >= 20))
	)
		return candidates.slice(0, 1)
	return candidates.slice(0, 3)
}

export function decodeTxt(bytes: Uint8Array, selected?: TxtEncoding) {
	if (selected) {
		const result = candidate(bytes, selected, false)
		if (!result) throw new TxtEncodingError('txt_decoding_failed', [])
		return result
	}
	const candidates = detectTxtEncoding(bytes)
	if (candidates.length !== 1)
		throw new TxtEncodingError('txt_encoding_unknown', candidates)
	return candidates[0]
}
