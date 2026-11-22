import { createHash } from 'node:crypto'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { compile, obj, opt, str } from '@earendil-works/pi-schema'
import {
	type ChapterPreview,
	chapterPreviewFields,
	entityId,
	formatVersion,
	projectFiles,
	type VolumeDigest,
	version,
} from '@novelive/format/model'
import {
	buildTextModel,
	createTextStream,
	type TextConnection,
} from '../models/text'
import type { Project } from '../project'

export interface PreviewChapter {
	chapterId: string
	volumeId: string
	paragraphs: string[]
}

const fields = compile(obj(chapterPreviewFields))
const digestFields = compile(obj({ summary: str() }))
const storedPreviewSchema = obj({
	...version,
	chapterId: entityId,
	...chapterPreviewFields,
	inputFingerprint: opt(str()),
})
const storedDigestSchema = obj({
	...version,
	volumeId: entityId,
	...chapterPreviewFields,
	inputFingerprint: opt(str()),
})
type Details = Omit<ChapterPreview, 'chapterId' | 'formatVersion'>
export type PreviewDigest = VolumeDigest & Omit<Details, 'summary'>

function fingerprint(input: unknown): string {
	return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function merge(parts: Details[]): Details {
	return {
		summary: parts.map((part) => part.summary).join('\n\n'),
		characters: unique(parts.flatMap((part) => part.characters)),
		locations: unique(parts.flatMap((part) => part.locations)),
		timelineNotes: unique(parts.flatMap((part) => part.timelineNotes)),
		foreshadowingHints: unique(
			parts.flatMap((part) => part.foreshadowingHints),
		),
	}
}

function unique<T>(items: T[]): T[] {
	return [
		...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
	]
}

export function splitChapter(paragraphs: string[], budget: number): string[] {
	if (!Number.isSafeInteger(budget) || budget < 1)
		throw new Error('Invalid preview budget')
	const segments: string[] = []
	let current = ''
	for (const paragraph of paragraphs) {
		if (current && current.length + 2 + paragraph.length > budget) {
			segments.push(current)
			current = ''
		}
		for (let offset = 0; offset < paragraph.length; ) {
			const separator = current ? '\n\n' : ''
			if (current.length + separator.length >= budget) {
				segments.push(current)
				current = ''
				continue
			}
			let count = Math.min(
				paragraph.length - offset,
				budget - current.length - separator.length,
			)
			if (
				offset + count < paragraph.length &&
				/[\uD800-\uDBFF]/.test(paragraph[offset + count - 1])
			)
				count--
			if (count === 0) {
				if (!current)
					throw new Error('Preview budget cannot fit Unicode character')
				segments.push(current)
				current = ''
				continue
			}
			current += separator + paragraph.slice(offset, offset + count)
			offset += count
			if (offset < paragraph.length) {
				segments.push(current)
				current = ''
			}
		}
	}
	if (current) segments.push(current)
	return segments
}

async function existing<T>(read: () => Promise<T>): Promise<T | undefined> {
	try {
		return await read()
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
			return undefined
		throw error
	}
}

export async function previewBook(
	project: Project,
	chapters: PreviewChapter[],
	options: {
		connection: TextConnection
		language: string
		signal?: AbortSignal
		fetch?: typeof globalThis.fetch
	},
): Promise<{ previews: ChapterPreview[]; digests: PreviewDigest[] }> {
	const model = buildTextModel(options.connection)
	const stream = createTextStream({ fetch: options.fetch })
	const outputTokens = Math.min(4096, Math.floor(model.contextWindow / 4))
	// Four tokens per UTF-16 unit conservatively cover UTF-8, with room for repair.
	const budget = Math.floor((model.contextWindow - outputTokens - 1024) / 4)
	if (budget < 1) throw new Error('Insufficient preview context')
	async function request(
		prompt: string,
		digest: boolean,
	): Promise<Details | { summary: string }> {
		const messages: { role: 'user'; content: string; timestamp: number }[] = [
			{ role: 'user', content: prompt, timestamp: 0 },
		]
		for (let attempt = 0; ; attempt++) {
			options.signal?.throwIfAborted()
			const result = await stream(model, normalizeContext({ messages }), {
				apiKey: options.connection.apiKey,
				signal: options.signal,
				maxTokens: outputTokens,
				cacheRetention: 'none',
			}).result()
			if (['error', 'aborted', 'length'].includes(result.stopReason))
				throw new Error(
					result.errorMessage ?? `Preview stopped: ${result.stopReason}`,
				)
			const text = result.content
				.flatMap((part) => (part.type === 'text' ? [part.text] : []))
				.join('')
			try {
				const value: unknown = JSON.parse(text)
				const checked = (digest ? digestFields : fields).validate(value)
				if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
				return checked.value
			} catch (error) {
				if (attempt === 1) throw error
				messages.push({
					role: 'user',
					content: `Repair JSON: ${String(error).slice(0, 64)}`,
					timestamp: 0,
				})
			}
		}
	}
	const previews: ChapterPreview[] = []
	const digests: PreviewDigest[] = []
	for (const volumeId of unique(chapters.map((chapter) => chapter.volumeId))) {
		const volume: ChapterPreview[] = []
		for (const chapter of chapters.filter(
			(chapter) => chapter.volumeId === volumeId,
		)) {
			options.signal?.throwIfAborted()
			const file = {
				path: projectFiles.preview(chapter.chapterId).path,
				schema: storedPreviewSchema,
			}
			const inputFingerprint = fingerprint({
				paragraphs: chapter.paragraphs,
				language: options.language,
			})
			let preview = await existing(() => project.read(file))
			if (!preview || preview.inputFingerprint !== inputFingerprint) {
				const parts: Details[] = []
				let previous = ''
				for (const segment of splitChapter(chapter.paragraphs, budget)) {
					parts.push(
						(await request(
							`Preview fiction in ${options.language}. Return JSON with summary, characters and locations (arrays of {name, description}), timelineNotes and foreshadowingHints (string arrays). Report only visible unexplained hooks, not narrator predictions.\nPrevious ending: ${previous}\nText:\n${segment}`,
							false,
						)) as Details,
					)
					previous = segment.slice(-128)
				}
				preview = {
					formatVersion,
					chapterId: chapter.chapterId,
					...merge(parts),
					inputFingerprint,
				}
				await project.write(file, preview)
			}
			volume.push(preview)
			previews.push(preview)
		}
		const file = projectFiles.digest(volumeId)
		const cachedDigest = await existing(() => project.read(file))
		let digest = compile(storedDigestSchema).check(cachedDigest)
			? cachedDigest
			: undefined
		const inputFingerprint = fingerprint({ volume, language: options.language })
		if (!digest || digest.inputFingerprint !== inputFingerprint) {
			const details = merge(volume)
			const summaries: string[] = []
			for (const segment of splitChapter(
				volume.map((preview) => JSON.stringify(preview)),
				budget,
			)) {
				summaries.push(
					(
						await request(
							`Summarize volume previews in ${options.language}; preserve characters, places, timeline and foreshadowing. Return JSON {"summary": string}.\n${segment}`,
							true,
						)
					).summary,
				)
			}
			digest = {
				formatVersion,
				volumeId,
				summary: summaries.join('\n\n'),
				characters: details.characters,
				locations: details.locations,
				timelineNotes: details.timelineNotes,
				foreshadowingHints: details.foreshadowingHints,
				inputFingerprint,
			}
			await project.write(file, digest)
		}
		digests.push(digest)
	}
	return { previews, digests }
}
