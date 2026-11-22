import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { importFixture, paragraphs, runGate } from './gate'

const fetch: typeof globalThis.fetch = async (input, init) => {
	const body = await new Request(input, init).json()
	const prompt: string = body.messages[0].content
	let result: object
	if (prompt.startsWith('Preview fiction')) {
		const text = prompt.split('\nText:\n')[1]
		const index = paragraphs.findIndex((parts) => parts.join('\n\n') === text)
		assert.notEqual(index, -1)
		result = {
			summary: text,
			characters: [],
			locations: [],
			timelineNotes: [],
			foreshadowingHints: [],
		}
	} else if (prompt.startsWith('Summarize volume')) {
		const ids = [...prompt.matchAll(/"chapterId":"(ch\d+)"/g)].map(
			(match) => match[1],
		)
		result = { summary: `Digest for ${ids.join(', ')}` }
	} else {
		const ids = [
			...prompt
				.split('\nChapter previews:\n')[1]
				.matchAll(/"chapterId":"(ch\d+)"/g),
		].map((match) => match[1])
		const first = ids[0] === 'ch0001'
		assert.ok(first || prompt.includes('"id":"bo"'))
		result = {
			overview: first
				? 'The key opens the tower.'
				: 'Bo hears the submerged bell.',
			chapters: ids.map((chapterId) => ({
				chapterId,
				progress: `Progress in ${chapterId}`,
			})),
			biblePatch: first
				? [
						{
							kind: 'character',
							op: 'update',
							entry: {
								id: 'ada',
								name: 'Adele',
								aliases: [],
								status: 'candidate',
							},
						},
						{
							kind: 'character',
							op: 'add',
							entry: {
								id: 'bo',
								name: 'Bo',
								aliases: [],
								firstSeenChapter: 'ch0002',
								status: 'candidate',
							},
						},
					]
				: [],
			glossaryPatch: [
				{
					id: first ? 'key' : 'bell',
					original: first ? 'key' : 'bell',
					written: first ? 'Blue Key' : 'Sunken Bell',
					category: 'item',
					status: 'candidate',
				},
			],
		}
	}
	const chunks = [
		{
			choices: [
				{
					index: 0,
					delta: { role: 'assistant', content: JSON.stringify(result) },
					finish_reason: null,
				},
			],
		},
		{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
	]
	return new Response(
		`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}

const directory = await mkdtemp(join(import.meta.dirname, '.author-'))
try {
	const root = join(directory, 'project')
	await importFixture(root)
	await rm(join(import.meta.dirname, 'cassette.jsonl'), { force: true })
	assert.equal(
		await runGate(
			root,
			createReplayFetch({
				mode: 'record',
				fetch,
				directory: import.meta.dirname,
				case: 'm1a-offline',
				tags: ['synthetic', 'not-a-provider-recording'],
			}),
		),
		7,
	)
} finally {
	await rm(directory, { recursive: true, force: true })
}
