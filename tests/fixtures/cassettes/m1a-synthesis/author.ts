import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Project } from '../../../../packages/creator/src/project'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { synthesizeVolume } from '../../../../packages/creator/src/synthesis'
import {
	changes,
	chapters,
	connection,
	glossaryChanges,
	planted,
	progress,
	seed,
} from './fixture'

const fetch: typeof globalThis.fetch = async (input, init) => {
	const body = await new Request(input, init).json()
	const prompt: string = body.messages[0].content
	const packet = /Extract only the next event in packet (\d+)\/(\d+)/.exec(
		prompt,
	)
	const eventIndex = Number(
		/^Events already extracted: (\d+)$/m.exec(prompt)?.[1] ?? 0,
	)
	const lastPacket = packet?.[1] === packet?.[2]
	const fragmentChapter = /^Chapter (\w+):$/m.exec(prompt)?.[1]
	const result = {
		overview: 'A key opens Paper Tower.',
		chapters: packet
			? eventIndex === 0
				? [progress[0]]
				: lastPacket
					? [
							progress.find(({ chapterId }) => chapterId === fragmentChapter) ??
								progress[1],
						]
					: []
			: progress,
		biblePatch: packet
			? eventIndex === 0
				? changes.slice(0, 2)
				: lastPacket
					? changes.slice(2)
					: []
			: changes,
		glossaryPatch: !packet || eventIndex === 0 ? glossaryChanges : [],
		...(packet
			? {
					event:
						`Synthetic event ${eventIndex + 1}` +
						(packet[2] === '1' ? '' : ' Detail.'.repeat(280)),
					is_last: packet[2] !== '1' || eventIndex > 0,
				}
			: {}),
	}
	if (body.model === 'fixture-synthesis-invalid') {
		result.biblePatch = [
			{
				kind: 'relation',
				op: 'add',
				entry: {
					id: 'invented',
					status: 'candidate',
					from: 'ada',
					to: 'missing',
					description: 'Invalid reference.',
				},
			},
		] as unknown as typeof changes
	}
	if (body.model === 'fixture-synthesis-cross-volume') {
		result.biblePatch = [
			{
				kind: 'foreshadowing',
				op: 'update',
				entry: { ...planted, resolvedChapter: 'c2' },
			},
		] as unknown as typeof changes
	}
	return new Response(
		`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
		{
			headers: { 'content-type': 'text/event-stream' },
		},
	)
}

const directory = await mkdtemp(join(tmpdir(), 'novelive-synthesis-author-'))
try {
	const cassette = import.meta.dirname
	await rm(join(cassette, 'cassette.jsonl'), { force: true })
	for (const [scenario, strategy, extended] of [
		['whole', 'whole', false],
		['events', 'events', false],
		['auto', 'auto', true],
		['invalid', 'whole', false],
		['cross-volume', 'whole', false],
	] as const) {
		const root = join(directory, scenario)
		await seed(root, extended, scenario === 'cross-volume')
		using project = await Project.open(root)
		const run = synthesizeVolume(project, 'v1', chapters, {
			incremental: scenario === 'cross-volume',
			strategy,
			language: 'en',
			connection:
				scenario === 'invalid' || scenario === 'cross-volume'
					? { ...connection, model: `fixture-synthesis-${scenario}` }
					: connection,
			fetch: createReplayFetch({
				mode: 'record',
				directory: cassette,
				fetch,
				case: scenario,
				tags: ['synthetic', 'not-a-provider-recording'],
			}),
		})
		if (scenario === 'invalid')
			await assert.rejects(run, /Unknown character reference: missing/)
		else await run
	}
} finally {
	await rm(directory, { recursive: true, force: true })
}
