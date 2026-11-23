import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { ArtProduction } from '../../packages/creator/src/pipeline/art'
import { writeChapter } from '../../packages/creator/src/pipeline/writing'
import { Project } from '../../packages/creator/src/project'
import { loadPlayerChapter } from '../../packages/creator/src/project/player'
import { productionBible } from '../../packages/creator/src/project/production-worker'
import {
	joinSeries,
	resolveSeries,
} from '../../packages/creator/src/project/series'
import { synthesizeVolume } from '../../packages/creator/src/synthesis'
import { prepareSeries } from '../../packages/creator/src/synthesis/incremental'
import {
	concatenateStyles,
	overlayEntries,
	projectFiles,
} from '../../packages/format/src/model'
import { connection } from '../fixtures/cassettes/m1a-synthesis/fixture'
import { fixtureOptions } from '../fixtures/cassettes/m1b-writer/fixture'

const roots: string[] = []
const network = vi.fn(async () => {
	throw new Error('Network forbidden')
})
afterEach(async () => {
	vi.unstubAllGlobals()
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	)
	expect(network).not.toHaveBeenCalled()
})

async function project() {
	vi.stubGlobal('fetch', network)
	const root = await mkdtemp(join(tmpdir(), 'm4-series-'))
	roots.push(root)
	return Project.create(join(root, 'project'), {
		formatVersion: 1,
		seriesId: 'series',
		title: 'Series',
		volumeIds: [],
	})
}
const book = {
	title: 'Volume',
	language: 'en',
	chapters: [{ title: 'Arrival', paragraphs: ['林晓握住星钥。'] }],
}
const character = {
	id: 'lin',
	status: 'confirmed' as const,
	name: 'Lin Xiao',
	originalName: '林晓',
	aliases: [],
	appearance: { description: 'Black hair' },
}
const term = {
	id: 'key',
	status: 'confirmed' as const,
	original: '星钥',
	written: 'Star Key',
	category: 'item',
}
const series = { level: 'series' } as const

function sse(content: unknown) {
	return new Response(
		`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}

test('whole-entry overlays and CSS follow series, volume, work order, including empty layers', async () => {
	expect(
		overlayEntries(
			[{ id: 'a', nested: { x: 1 } }],
			[{ id: 'a', nested: { y: 2 } }],
		),
	).toEqual([{ id: 'a', nested: { y: 2 } }])
	expect(overlayEntries()).toEqual([])
	expect(concatenateStyles('', 'a', '', 'b')).toBe('a\nb')
	using p = await project()
	const joined = await joinSeries(p, book)
	const scopes = [
		series,
		{ level: 'volume', volumeId: joined.volumeId } as const,
		{
			level: 'work',
			volumeId: joined.volumeId,
			workId: joined.workId,
		} as const,
	]
	expect((await resolveSeries(p, scopes[2])).bible.character).toEqual([])
	for (const [i, scope] of scopes.entries()) {
		await p.write(projectFiles.character(scope, 'lin'), {
			formatVersion: 1,
			entries: [
				i === 0
					? character
					: { id: 'lin', status: 'confirmed', name: `Name ${i}`, aliases: [] },
			],
		})
		await p.write(projectFiles.glossary(scope), {
			formatVersion: 1,
			entries: [{ ...term, written: `Key ${i}` }],
		})
		await p.write(projectFiles.assetRegistry(scope), {
			formatVersion: 1,
			entries: [
				{
					id: 'lin/default/neutral',
					type: 'character',
					status: 'drawn',
					path: `assets/${i}.webp`,
					aliases: [],
				},
			],
		})
		await p.writeFile(projectFiles.styles(scope), `.mark { color: color${i}; }`)
		const resolved = await resolveSeries(p, scopes[2])
		expect(resolved.bible.character[0].name).toBe(
			i ? `Name ${i}` : character.name,
		)
	}
	const effective = await resolveSeries(p, scopes[2])
	expect(effective.bible.character).toEqual([
		{ id: 'lin', status: 'confirmed', name: 'Name 2', aliases: [] },
	])
	expect(effective.bible.glossary[0].written).toBe('Key 2')
	expect(effective.registry.entries[0].path).toBe('assets/2.webp')
	expect(effective.styles).toBe(
		scopes.map((_, i) => `.mark { color: color${i}; }`).join('\n'),
	)
	await p.writeFile(projectFiles.glossary(scopes[2]).path, '{broken')
	await expect(resolveSeries(p, scopes[2])).rejects.toThrow('invalid JSON')
})

test('join appends collision-free sources without modifying shared entries or originals', async () => {
	using p = await project()
	await p.writeFile('source/original.txt', 'old original')
	await p.writeFile('source/chapters/ch1.txt', 'old chapter')
	await p.write(projectFiles.character(series, 'lin'), {
		formatVersion: 1,
		entries: [character],
	})
	await p.write(projectFiles.glossary(series), {
		formatVersion: 1,
		entries: [term],
	})
	await p.write(projectFiles.assetRegistry(series), {
		formatVersion: 1,
		entries: [],
	})
	const files = [
		'source/original.txt',
		'source/chapters/ch1.txt',
		'bible/characters/lin.json',
		'glossary.json',
		'assets/asset-registry.json',
	]
	const before = await Promise.all(files.map((file) => p.readFile(file)))
	const first = await joinSeries(p, {
		...book,
		original: { extension: 'txt', bytes: Buffer.from('new original') },
	})
	const second = await joinSeries(p, book)
	expect(second.volumeId).not.toBe(first.volumeId)
	expect(second.chapterIds[0]).not.toBe(first.chapterIds[0])
	expect((await p.read(projectFiles.series)).volumeIds).toEqual([
		first.volumeId,
		second.volumeId,
	])
	expect(
		await p.readFile(`source/imports/${first.volumeId}/original.txt`),
	).toEqual(Buffer.from('new original'))
	expect(await Promise.all(files.map((file) => p.readFile(file)))).toEqual(
		before,
	)
	await expect(joinSeries(p, { ...book, chapters: [] })).rejects.toThrow(
		'nonempty chapters',
	)
	expect((await p.read(projectFiles.series)).volumeIds).toHaveLength(2)
})

test('volume two art reuses a drawn series character and writer uses target language and canonical names', async () => {
	using p = await project()
	const first = await joinSeries(p, book)
	const second = await joinSeries(p, book)
	await p.write(projectFiles.character(series, 'lin'), {
		formatVersion: 1,
		entries: [character],
	})
	await p.write(projectFiles.glossary(series), {
		formatVersion: 1,
		entries: [term],
	})
	const asset = {
		id: 'lin/default/neutral',
		type: 'character' as const,
		path: 'assets/lin.webp',
		status: 'drawn' as const,
		aliases: [],
	}
	const { bible, art } = await productionBible(
		p,
		second.volumeId,
		second.workId,
	)
	const imageFetch = vi.fn<typeof fetch>(async () => {
		throw new Error('Unexpected image request')
	})
	const artOptions = {
		main: connection,
		fast: connection,
		visual: connection,
		image: {
			baseUrl: 'https://relay.invalid/v1',
			apiKey: 'offline',
			model: 'fixture-image',
			concurrency: 1,
			retries: 0,
			quality: 'low' as const,
			nativeMaxEdge: 1536 as const,
			postProcess: 'off' as const,
			upscaleTier: 'anime' as const,
		},
		replay: { mode: 'strict' as const, fetch: imageFetch },
	}
	const firstService = new ArtProduction(p, {
		...artOptions,
		readScope: {
			level: 'work',
			volumeId: first.volumeId,
			workId: first.workId,
		},
	})
	await firstService.register(
		[{ id: asset.id, kind: 'character', description: 'Lin' }],
		art,
	)
	await p.writeFile(
		'source/portrait.webp',
		Buffer.from('existing character pixels'),
	)
	await firstService.adopt(asset.id, 'source/portrait.webp')
	const service = new ArtProduction(p, {
		...artOptions,
		readScope: {
			level: 'work',
			volumeId: second.volumeId,
			workId: second.workId,
		},
	})
	const jobs = await service.register(
		[{ id: asset.id, kind: 'character', description: 'Lin' }],
		art,
		undefined,
		undefined,
		async ({ jobs }) => {
			expect(jobs.map((job) => job.assetId)).toEqual([asset.id])
		},
	)
	for (const job of jobs)
		expect(await service.draw(job, art)).toEqual({ status: 'drawn' })
	expect((await service.registry()).entries[0].status).toBe('drawn')
	expect(imageFetch).not.toHaveBeenCalled()
	const requests: string[] = []
	const synthetic: typeof fetch = async (input, init) => {
		requests.push(
			JSON.stringify((await new Request(input, init).json()).messages),
		)
		return sse('scene Arrival\nsource p0001\nlin: Lin Xiao held the Star Key.')
	}
	const options = fixtureOptions(synthetic)
	options.script.speakers = ['lin']
	const result = await writeChapter(
		{
			chapterId: second.chapterIds[0],
			language: 'en',
			continuity: { kind: 'none' },
			paragraphs: [{ id: 'p0001', text: book.chapters[0].paragraphs[0] }],
			bible: JSON.stringify(bible),
			terms: { 星钥: 'Star Key' },
			canonicalNames: {
				characters: bible.character,
				locations: bible.location,
			},
		},
		options,
	)
	expect(requests.join('\n')).toContain('target language en')
	expect(requests.join('\n')).toContain('林晓 → Lin Xiao (ID: lin)')
	expect(requests.join('\n')).toContain('星钥 → Star Key')
	expect(result.scenes).toHaveLength(1)
})

test('incremental preparation reports volume one before later work, passes digests and effective Bible, and resumes', async () => {
	using p = await project()
	const first = await joinSeries(p, book)
	const second = await joinSeries(p, book)
	await p.write(projectFiles.character(series, 'lin'), {
		formatVersion: 1,
		entries: [character],
	})
	await p.write(
		projectFiles.character(
			{ level: 'work', volumeId: second.volumeId, workId: second.workId },
			'lin',
		),
		{ formatVersion: 1, entries: [{ ...character, name: 'Volume Two Lin' }] },
	)
	const ready: string[] = []
	const enteredSecond = Promise.withResolvers<void>()
	const release = Promise.withResolvers<void>()
	const requests: string[] = []
	const synthetic: typeof fetch = async (input, init) => {
		const body = await new Request(input, init).json()
		const prompt = body.messages[0].content as string
		requests.push(prompt)
		if (ready.length && prompt.startsWith('Preview fiction')) {
			enteredSecond.resolve()
			await release.promise
		}
		if (prompt.startsWith('Preview fiction'))
			return sse({
				summary: 'Arrival',
				characters: [],
				locations: [],
				timelineNotes: [],
				foreshadowingHints: [],
			})
		if (prompt.startsWith('Summarize volume'))
			return sse({ summary: 'Earlier arrival digest' })
		const chapterId = ready.length ? second.chapterIds[0] : first.chapterIds[0]
		return sse({
			overview: 'Arrival',
			chapters: [{ chapterId, progress: 'Arrived' }],
			biblePatch: [],
			glossaryPatch: [],
		})
	}
	const options = {
		previewConnection: connection,
		synthesisConnection: connection,
		language: 'en',
		fetch: synthetic,
		onReady: (id: string) => {
			ready.push(id)
		},
	}
	const running = prepareSeries(p, options)
	await enteredSecond.promise
	expect(ready).toEqual([first.volumeId])
	release.resolve()
	await running
	expect(ready).toEqual([first.volumeId, second.volumeId])
	const later = requests.filter((prompt) => prompt.startsWith('Synthesize'))[1]
	expect(later).toContain('Earlier volume digests')
	expect(later).toContain('Earlier arrival digest')
	expect(later).toContain('Volume Two Lin')
	expect(later).toContain('do not emit delete')
	const count = requests.length
	await prepareSeries(p, { ...options, onReady: undefined })
	expect(requests).toHaveLength(count)
})

test('art registration persists local entries without freezing inherited rows', async () => {
	using p = await project()
	const joined = await joinSeries(p, book)
	const scope = {
		level: 'work',
		volumeId: joined.volumeId,
		workId: joined.workId,
	} as const
	await p.write(projectFiles.assetRegistry(series), {
		formatVersion: 1,
		entries: [
			{
				id: 'room/day',
				type: 'location',
				path: 'assets/room.webp',
				status: 'drawn',
				aliases: [],
			},
		],
	})
	const { art } = await productionBible(p, joined.volumeId, joined.workId)
	const service = new ArtProduction(p, {
		scope,
		main: connection,
		fast: connection,
		visual: connection,
		image: {
			baseUrl: 'https://relay.invalid/v1',
			apiKey: 'offline',
			model: 'fixture-image',
			concurrency: 1,
			retries: 0,
			quality: 'low',
			nativeMaxEdge: 1536,
			postProcess: 'off',
			upscaleTier: 'anime',
		},
	})
	await service.register(
		[{ id: 'cg-local', kind: 'cg', description: 'Local scene' }],
		art,
	)
	expect(
		(await p.read(projectFiles.assetRegistry(scope))).entries.map(
			({ id }) => id,
		),
	).toEqual(['cg-local'])
	await p.write(projectFiles.assetRegistry(series), {
		formatVersion: 1,
		entries: [
			{
				id: 'room/day',
				type: 'location',
				path: 'assets/updated.webp',
				status: 'drawn',
				aliases: [],
			},
		],
	})
	expect(
		(await service.registry()).entries.find(({ id }) => id === 'room/day')
			?.path,
	).toBe('assets/updated.webp')
})

test('synthesis requests repair for work-only relation references before series publication', async () => {
	using p = await project()
	const joined = await joinSeries(p, book)
	const scope = {
		level: 'work',
		volumeId: joined.volumeId,
		workId: joined.workId,
	} as const
	await p.write(projectFiles.character(scope, 'lin'), {
		formatVersion: 1,
		entries: [character, { ...character, id: 'guest', name: 'Guest' }],
	})
	const chapterId = joined.chapterIds[0]
	await p.write(projectFiles.preview(chapterId), {
		formatVersion: 1,
		chapterId,
		summary: 'They meet.',
		characters: [],
		locations: [],
		timelineNotes: [],
		foreshadowingHints: [],
	})
	const prompts: string[] = []
	const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
		const body = await new Request(input, init).json()
		prompts.push(JSON.stringify(body.messages))
		return sse({
			overview: 'They meet.',
			chapters: [{ chapterId, progress: 'Met' }],
			biblePatch: [
				...(prompts.length > 1
					? [character, { ...character, id: 'guest', name: 'Guest' }].map(
							(entry) => ({
								kind: 'character',
								op: 'add',
								entry: { ...entry, status: 'candidate' },
							}),
						)
					: []),
				{
					kind: 'relation',
					op: 'add',
					entry: {
						id: 'meeting',
						status: 'candidate',
						from: 'lin',
						to: 'guest',
						description: 'Friends',
					},
				},
			],
			glossaryPatch: [],
		})
	})
	const result = await synthesizeVolume(p, joined.volumeId, [chapterId], {
		connection,
		scope,
		language: 'en',
		incremental: true,
		fetch,
	})
	expect(fetch).toHaveBeenCalledTimes(2)
	expect(prompts[1]).toContain('Repair the JSON')
	expect(result.biblePatch.some(({ entry }) => entry.id === 'meeting')).toBe(
		true,
	)
	expect(result.conflicts).toEqual([])
})

test('production updates the effective asset and style owners without hiding artwork from playback', async () => {
	using p = await project()
	const joined = await joinSeries(p, book)
	const scope = {
		level: 'work',
		volumeId: joined.volumeId,
		workId: joined.workId,
	} as const
	const baseStyle = {
		id: 'style',
		status: 'confirmed' as const,
		description: 'Series style',
	}
	const workStyle = {
		id: 'style',
		status: 'candidate' as const,
		description: 'Work style',
	}
	await p.write(projectFiles.style(series), {
		formatVersion: 1,
		entries: [baseStyle],
	})
	await p.write(projectFiles.style(scope), {
		formatVersion: 1,
		entries: [workStyle],
	})
	const asset = {
		id: 'room/day',
		type: 'location' as const,
		path: 'assets/work-room.webp',
		status: 'pending' as const,
		aliases: [],
	}
	await p.write(projectFiles.assetRegistry(scope), {
		formatVersion: 1,
		entries: [asset],
	})
	const pixels = await sharp({
		create: { width: 8, height: 8, channels: 3, background: '#223344' },
	})
		.webp()
		.toBuffer()
	await p.writeFile(asset.path, pixels)
	await p.writeFile('source/visual.webp', pixels)
	const { art } = await productionBible(p, joined.volumeId, joined.workId)
	const service = new ArtProduction(p, {
		readScope: scope,
		resolution: '2K',
		main: connection,
		fast: connection,
		visual: connection,
		image: {
			baseUrl: 'https://relay.invalid/v1',
			apiKey: 'offline',
			model: 'fixture-image',
			concurrency: 1,
			retries: 0,
			quality: 'low',
			nativeMaxEdge: 1536,
			postProcess: 'off',
			upscaleTier: 'anime',
		},
	})
	const jobs = await service.register(
		[{ id: asset.id, kind: 'location', description: 'A room' }],
		art,
	)
	await service.draw(jobs[0], art)
	expect(
		(await p.read(projectFiles.assetRegistry(scope))).entries[0].status,
	).toBe('drawn')
	const playback = await loadPlayerChapter(
		p.root,
		joined.workId,
		join(p.root, 'cache'),
	)
	expect(playback.registry.entries[0].status).toBe('drawn')
	expect(playback.registry.entries[0].path).not.toContain('unavailable')
	await service.confirmVisual(
		workStyle,
		{
			mainVisuals: [{ id: 'main', cachePath: 'source/visual.webp' }],
			supplemental: [],
			characters: [],
		},
		{ mainVisualId: 'main', supplementalIds: [], characters: [] },
	)
	expect((await p.read(projectFiles.style(series))).entries).toEqual([
		baseStyle,
	])
	const confirmedStyle = (await p.read(projectFiles.style(scope))).entries[0]
	expect(confirmedStyle.status).toBe('confirmed')
	expect(confirmedStyle.description).toBe('Work style')
	expect(confirmedStyle.references?.[0].path).toContain(
		`volumes/${joined.volumeId}/works/${joined.workId}/`,
	)
})
