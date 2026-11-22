import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { previewBook, splitChapter } from '../../packages/creator/src/preview'
import { Project } from '../../packages/creator/src/project'
import { createReplayFetch } from '../../packages/creator/src/replay'
import { projectFiles } from '../../packages/format/src/model'
import {
	addedChapter,
	chapters,
	connection,
	editedChapter,
} from '../fixtures/cassettes/m1a-preview/fixture'

let directory: string
let root: string
const cassetteDirectory = 'tests/fixtures/cassettes/m1a-preview'
const network = vi.fn<typeof globalThis.fetch>(async () => {
	throw new Error('Network forbidden')
})
const replay = () =>
	createReplayFetch({
		mode: 'strict',
		directory: cassetteDirectory,
		fetch: network,
	})
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-preview-'))
	root = join(directory, 'project')
	using _project = await Project.create(root, {
		formatVersion: 1,
		seriesId: 'synthetic',
		title: 'Paper sea',
		volumeIds: ['v1', 'v2'],
	})
	network.mockClear()
})
afterEach(async () => {
	await rm(directory, { recursive: true, force: true })
})

test('splits on paragraph boundaries, reads every character even in an oversized paragraph', () => {
	for (const paragraphs of [
		[],
		[''],
		['one', 'two'],
		['x'.repeat(2001), 'end'],
		['a😀星'.repeat(600)],
		chapters[0].paragraphs,
	]) {
		const segments = splitChapter(paragraphs, 512)
		expect(segments.every((segment) => segment.length <= 512)).toBe(true)
		expect(segments.every((segment) => segment.isWellFormed())).toBe(true)
		expect(segments.join('').replaceAll('\n', '')).toBe(paragraphs.join(''))
	}
	expect(splitChapter(['abc', 'def'], 5)).toEqual(['abc', 'def'])
	expect(() => splitChapter(['x'], 0)).toThrow('Invalid preview budget')
})

test('strict replay covers all chapters, segments and per-volume facts on disk', async () => {
	using project = await Project.open(root)
	const requests: string[] = []
	const strict = replay()
	const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
		const request = new Request(input, init)
		requests.push(JSON.stringify(await request.clone().json()))
		return strict(request)
	})
	const result = await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch,
	})
	expect(result.previews).toHaveLength(3)
	expect(result.digests).toHaveLength(2)
	const inputs = requests.map(
		(request) => JSON.parse(request).messages[0].content as string,
	)
	const previewInputs = inputs.filter((input) => input.includes('\nText:\n'))
	expect(previewInputs.length).toBeGreaterThan(chapters.length)
	const covered = previewInputs
		.map((input) => input.split('\nText:\n')[1])
		.join('')
	expect(covered.replaceAll('\n', '')).toBe(
		chapters.flatMap((chapter) => chapter.paragraphs).join(''),
	)
	for (const preview of result.previews)
		expect(await project.read(projectFiles.preview(preview.chapterId))).toEqual(
			preview,
		)
	const digest = JSON.parse(
		await readFile(join(root, projectFiles.digest('v1').path), 'utf8'),
	)
	expect(
		digest.characters.map((entry: { name: string }) => entry.name),
	).toEqual(expect.arrayContaining(['Ada', 'Bo']))
	expect(digest.locations.map((entry: { name: string }) => entry.name)).toEqual(
		expect.arrayContaining(['Paper Harbor', 'Ink Island']),
	)
	expect(digest.timelineNotes.join(' ')).toContain('day three')
	expect(digest.foreshadowingHints.join(' ')).toContain('key')
	expect(JSON.stringify(result.digests[1])).not.toContain('Paper Harbor')
	expect(network).not.toHaveBeenCalled()
})

test('restart reuses completed chapter files and volume digests without model calls', async () => {
	let project = await Project.open(root)
	const strict = replay()
	let calls = 0
	const fetch: typeof globalThis.fetch = async (input, init) => {
		if (++calls >= 3) throw new Error('interrupted')
		return strict(input, init)
	}
	await expect(
		previewBook(project, chapters, { connection, language: 'en', fetch }),
	).rejects.toThrow()
	const first = await project.readFile(projectFiles.preview('c1').path)
	project.close()
	project = await Project.open(root)
	try {
		const resumed = vi.fn(replay())
		await previewBook(project, chapters, {
			connection,
			language: 'en',
			fetch: resumed,
		})
		expect(await project.readFile(projectFiles.preview('c1').path)).toEqual(
			first,
		)
		expect(resumed).toHaveBeenCalled()
		for (const [input, init] of resumed.mock.calls) {
			const payload = await new Request(input, init).json()
			expect(JSON.stringify(payload)).not.toContain('Ada entered Paper Harbor')
		}
		const unused = vi.fn(replay())
		await previewBook(project, chapters, {
			connection,
			language: 'en',
			fetch: unused,
		})
		expect(unused).not.toHaveBeenCalled()
	} finally {
		project.close()
	}
})

test('edited chapter text invalidates its preview and volume digest but reuses other chapters', async () => {
	using project = await Project.open(root)
	await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: replay(),
	})
	const before = await project.readFile(projectFiles.preview('c1').path)
	const oldDigest = await project.readFile(projectFiles.digest('v1').path)
	const result = await previewBook(
		project,
		[chapters[0], editedChapter, chapters[2]],
		{ connection, language: 'en', fetch: replay() },
	)
	expect(
		result.previews.find((preview) => preview.chapterId === 'c2')?.characters,
	).toContainEqual({ name: 'Cy' })
	expect(await project.readFile(projectFiles.preview('c1').path)).toEqual(
		before,
	)
	expect(await project.readFile(projectFiles.digest('v1').path)).not.toEqual(
		oldDigest,
	)
	expect(result.digests[0].characters).toContainEqual({ name: 'Cy' })
	const unused = vi.fn(replay())
	await previewBook(project, [chapters[0], editedChapter, chapters[2]], {
		connection,
		language: 'en',
		fetch: unused,
	})
	expect(unused).not.toHaveBeenCalled()
})

test('adding a chapter invalidates its volume digest without redoing finished chapters', async () => {
	using project = await Project.open(root)
	await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: replay(),
	})
	const oldDigest = await project.readFile(projectFiles.digest('v1').path)
	const strict = replay()
	const prompts: string[] = []
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init)
		prompts.push((await request.clone().json()).messages[0].content)
		return strict(request)
	}
	const result = await previewBook(project, [...chapters, addedChapter], {
		connection,
		language: 'en',
		fetch,
	})
	expect(prompts.filter((prompt) => prompt.includes('\nText:\n'))).toHaveLength(
		1,
	)
	expect(
		prompts.some((prompt) => prompt.includes(addedChapter.paragraphs[0])),
	).toBe(true)
	expect(await project.readFile(projectFiles.digest('v1').path)).not.toEqual(
		oldDigest,
	)
	expect(result.digests[0].characters).toContainEqual({ name: 'Cy' })
})

test('a summary-only digest valid under the shared schema is stale rather than invalid', async () => {
	using project = await Project.open(root)
	await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: replay(),
	})
	await project.write(projectFiles.digest('v1'), {
		formatVersion: 1,
		volumeId: 'v1',
		summary: 'An older summary.',
	})
	const strict = replay()
	const prompts: string[] = []
	const result = await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: async (input, init) => {
			const request = new Request(input, init)
			prompts.push((await request.clone().json()).messages[0].content)
			return strict(request)
		},
	})
	expect(prompts.length).toBeGreaterThan(0)
	expect(
		prompts.every((prompt) => prompt.startsWith('Summarize volume previews')),
	).toBe(true)
	expect(result.digests[0].characters).toContainEqual({ name: 'Ada' })
	expect(await project.read(projectFiles.digest('v1'))).toMatchObject({
		inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
		characters: expect.any(Array),
	})
})

test('shared-schema previews with extra fields regenerate if unfingerprinted, while compatible digests remain reusable', async () => {
	using project = await Project.open(root)
	await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: replay(),
	})
	const legacyPreview = {
		formatVersion: 1 as const,
		chapterId: 'c1',
		summary: 'Legacy preview',
		characters: [],
		locations: [],
		timelineNotes: [],
		foreshadowingHints: [],
		annotation: 'extension from another producer',
	}
	await project.write(projectFiles.preview('c1'), legacyPreview)
	const strict = replay()
	const prompts: string[] = []
	const result = await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: async (input, init) => {
			const request = new Request(input, init)
			prompts.push((await request.clone().json()).messages[0].content)
			return strict(request)
		},
	})
	expect(prompts.filter((prompt) => prompt.includes('\nText:\n'))).toHaveLength(
		2,
	)
	expect(result.previews[0].characters).toContainEqual({ name: 'Ada' })
	expect(result.previews[0]).toMatchObject({
		inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
	})
	const compatibleDigest = {
		...(await project.read(projectFiles.digest('v1'))),
		annotation: 'compatible digest extension',
	}
	await project.write(projectFiles.digest('v1'), compatibleDigest)
	const unused = vi.fn(replay())
	await previewBook(project, chapters, {
		connection,
		language: 'en',
		fetch: unused,
	})
	expect(unused).not.toHaveBeenCalled()
})

test('empty input makes no calls; cancellation and strict misses do not persist unfinished chapters', async () => {
	using project = await Project.open(root)
	const fetch = vi.fn(replay())
	expect(
		await previewBook(project, [], { connection, language: 'en', fetch }),
	).toEqual({ previews: [], digests: [] })
	expect(fetch).not.toHaveBeenCalled()
	await expect(
		previewBook(project, chapters, {
			connection,
			language: 'en',
			signal: AbortSignal.abort(),
			fetch,
		}),
	).rejects.toMatchObject({ name: 'AbortError' })
	await expect(
		previewBook(
			project,
			[{ chapterId: 'missing', volumeId: 'v1', paragraphs: ['unrecorded'] }],
			{ connection, language: 'en', fetch },
		),
	).rejects.toThrow()
	await expect(
		project.read(projectFiles.preview('missing')),
	).rejects.toMatchObject({ code: 'ENOENT' })
	expect(network).not.toHaveBeenCalled()
})

test.each(['repair', 'invalid', 'length'])(
	'validates and repairs model JSON once: %s',
	async (mode) => {
		using project = await Project.open(root)
		const fetch = vi.fn(replay())
		const run = previewBook(project, [chapters[1]], {
			connection: { ...connection, model: `fixture-preview-${mode}` },
			language: 'en',
			fetch,
		})
		if (mode === 'repair') {
			expect((await run).previews[0].characters).toEqual([{ name: 'Ada' }])
		} else {
			await expect(run).rejects.toThrow()
			await expect(
				project.read(projectFiles.preview('c2')),
			).rejects.toMatchObject({ code: 'ENOENT' })
			expect(fetch).toHaveBeenCalledTimes(mode === 'invalid' ? 2 : 1)
		}
		expect(network).not.toHaveBeenCalled()
	},
)
