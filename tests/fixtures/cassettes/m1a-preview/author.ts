import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { previewBook } from '../../../../packages/creator/src/preview'
import { Project } from '../../../../packages/creator/src/project'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { chapters, connection } from './fixture'

// Local synthetic SSE only; never contacts a provider.
const fetch: typeof globalThis.fetch = async (input, init) => {
	const request = new Request(input, init)
	const body = await request.json()
	const prompt: string = body.messages[0].content
	const text = prompt.split('\nText:\n')[1] ?? prompt
	const details = {
		summary: text.includes('Cy')
			? 'Cy heard a submerged bell.'
			: text.includes('Bo')
				? 'Ada and Bo investigated the key and tower.'
				: 'Ada investigated the key and tower.',
		characters: ['Ada', 'Bo', 'Cy']
			.filter((name) => text.includes(name))
			.map((name) => ({ name })),
		locations: ['Paper Harbor', 'Ink Island']
			.filter((name) => text.includes(name))
			.map((name) => ({ name })),
		timelineNotes: ['day one', 'day two', 'day three', 'day four'].filter(
			(day) => text.includes(day),
		),
		foreshadowingHints: ['key', 'tower', 'bell'].filter((hook) =>
			text.includes(hook),
		),
	}
	const result = prompt.startsWith('Summarize')
		? { summary: details.summary }
		: details
	const invalid =
		body.model === 'fixture-preview-invalid' ||
		(body.model === 'fixture-preview-repair' && body.messages.length === 1)
	return new Response(
		`${[
			{
				choices: [
					{
						index: 0,
						delta: {
							role: 'assistant',
							content: invalid ? '{}' : JSON.stringify(result),
						},
						finish_reason: null,
					},
				],
			},
			{
				choices: [
					{
						index: 0,
						delta: {},
						finish_reason:
							body.model === 'fixture-preview-length' ? 'length' : 'stop',
					},
				],
			},
		]
			.map((event) => `data: ${JSON.stringify(event)}\n\n`)
			.join('')}data: [DONE]\n\n`,
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}

const directory = await mkdtemp(join(tmpdir(), 'novelive-author-'))
try {
	await rm('tests/fixtures/cassettes/m1a-preview/cassette.jsonl', {
		force: true,
	})
	for (const model of [
		'fixture-preview',
		'fixture-preview-repair',
		'fixture-preview-invalid',
		'fixture-preview-length',
	]) {
		using project = await Project.create(join(directory, model), {
			formatVersion: 1,
			seriesId: 'synthetic',
			title: 'Paper sea',
			volumeIds: ['v1', 'v2'],
		})
		try {
			await previewBook(
				project,
				model === 'fixture-preview' ? chapters : [chapters[1]],
				{
					connection: { ...connection, model },
					language: 'en',
					fetch: createReplayFetch({
						mode: 'record',
						directory: 'tests/fixtures/cassettes/m1a-preview',
						fetch,
						case: 'preview',
						tags: ['synthetic', 'not-a-provider-recording'],
					}),
				},
			)
		} catch (error) {
			if (
				!['fixture-preview-invalid', 'fixture-preview-length'].includes(model)
			)
				throw error
		}
	}
} finally {
	await rm(directory, { recursive: true, force: true })
}
