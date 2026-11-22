import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConfigStore } from '../../../../packages/creator/src/config'
import { importTxtProject } from '../../../../packages/creator/src/import/wizard'
import { createProduction } from '../../../../packages/creator/src/project/production'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { bible, picture } from '../m1b-art/fixture'
import { artDirectory, configuration, gateDirectory, original } from './fixture'

const existing = createReplayFetch({ mode: 'strict', directory: artDirectory })
let hits = 0
let secondAttempts = 0
function completion(content: string, tool?: string) {
	const delta = tool
		? {
				tool_calls: [
					{
						index: 0,
						id: 'submit-review',
						type: 'function',
						function: { name: tool, arguments: content },
					},
				],
			}
		: { content }
	const frames = [
		{
			choices: [
				{
					index: 0,
					delta: { role: 'assistant', ...delta },
					finish_reason: null,
				},
			],
		},
		{
			choices: [
				{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' },
			],
		},
	]
	return new Response(
		`${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
		{
			headers: { 'content-type': 'text/event-stream' },
		},
	)
}

const synthetic: typeof globalThis.fetch = async (input, init) => {
	const request = new Request(input, init)
	assert.equal(new URL(request.url).origin, 'https://relay.invalid')
	const path = new URL(request.url).pathname
	const body = request.headers.get('content-type')?.startsWith('multipart/')
		? Object.fromEntries(await request.formData())
		: await request.json()
	if (path.includes('/images/')) {
		const [width, height] = body.size.split('x').map(Number)
		const bytes = body.prompt.includes('远处昏暗的旧桥')
			? Buffer.from('bad image')
			: await picture(width, height, body.background === 'transparent')
		return Response.json({ data: [{ b64_json: bytes.toString('base64') }] })
	}
	const last = body.messages.at(-1).content
	const prompt: string = typeof last === 'string' ? last : last[0].text
	if (
		body.tools?.some(
			({ function: { name } }: { function: { name: string } }) =>
				name === 'submit_review',
		)
	)
		return completion('{"issues":[]}', 'submit_review')
	if (prompt.startsWith('Write a visual novel adaptation')) {
		const second = prompt.includes('p0001: 桥边的灯亮了')
		if (second && ++secondAttempts === 1)
			return Response.json(
				{ error: { message: 'Temporary fixture rejection' } },
				{ status: 400 },
			)
		return completion(
			second
				? 'scene 灯火\nsource p0001\n\n: 桥边的灯亮了，纸船继续向前漂。'
				: 'scene 纸船\nsource p0001\n\n: 暮色中，一只纸船从桥下漂过。',
		)
	}
	if (prompt.startsWith('You are the art director')) {
		const second = prompt.includes('scene 灯火')
		return completion(
			JSON.stringify({
				patch: second
					? 'PUT <4:\n@bg room/night'
					: 'PUT <4:\n@bg room/day\n@show ada/uniform/neutral center',
				items: second
					? [
							{
								id: 'room/night',
								kind: 'variant',
								description: '远处昏暗的旧桥',
							},
						]
					: [
							{
								id: 'room/day',
								kind: 'location',
								description: '暮色中的安静桥边',
							},
						],
				merges: {},
			}),
		)
	}
	if (prompt.startsWith('Write only visible content'))
		return completion(
			JSON.stringify({
				content: prompt.includes('远处昏暗的旧桥')
					? '远处昏暗的旧桥'
					: '窗外暮色，窗边一道微光。',
			}),
		)
	if (prompt.startsWith('Visually audit'))
		return completion('{"pass":true,"failedChecks":[],"feedback":""}')
	if (prompt.startsWith('Preview fiction'))
		return completion(
			JSON.stringify({
				summary: prompt.includes('桥边的灯亮了')
					? '灯火照亮纸船的去路。'
					: '纸船在暮色中经过桥下。',
				characters: [],
				locations: [],
				timelineNotes: [],
				foreshadowingHints: [],
			}),
		)
	if (prompt.startsWith('Summarize volume'))
		return completion('{"summary":"一只纸船在暮光中启程。"}')
	assert.ok(prompt.includes('Chapter previews:'), prompt.slice(0, 120))
	return completion(
		JSON.stringify({
			overview: '暮色下，纸船穿过旧桥，随灯火继续漂流。',
			chapters: ['ch0001', 'ch0002'].map((chapterId) => ({
				chapterId,
				progress: '纸船继续漂流。',
			})),
			biblePatch: [
				{ op: 'add', kind: 'style', entry: bible.style },
				{
					op: 'add',
					kind: 'character',
					entry: {
						...bible.characters[0],
						status: 'candidate',
						firstSeenChapter: 'ch0001',
					},
				},
				{
					op: 'add',
					kind: 'location',
					entry: { ...bible.locations[0], status: 'candidate' },
				},
			],
			glossaryPatch: [],
		}),
	)
}

const record = createReplayFetch({
	mode: 'record',
	directory: gateDirectory,
	fetch: synthetic,
	case: 'm1b-gate',
	tags: ['synthetic', 'no-provider'],
})
const fetch: typeof globalThis.fetch = async (input, init) => {
	const request = new Request(input, init)
	try {
		const response = await existing(request.clone())
		hits++
		return response
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!error.message.startsWith('Missing strict replay cassette:')
		)
			throw error
		return record(request).catch((failure) => {
			console.error(failure)
			throw failure
		})
	}
}

const root = await mkdtemp(join(homedir(), '.m1b-gate-author-'))
try {
	await rm(join(gateDirectory, 'cassette.jsonl'), { force: true })
	const config = createConfigStore(root)
	await config.update(configuration)
	const sourcePath = join(root, 'paper-boat.txt')
	await writeFile(sourcePath, original)
	const imported = await importTxtProject({
		sourcePath,
		folder: root,
		title: '纸船与灯火',
		encoding: 'utf-8',
		references: [],
	})
	assert.equal(imported.status, 'ready')
	if (imported.status !== 'ready') throw new Error('TXT fixture did not import')
	const { workId, projectDir } = imported
	const production = createProduction(
		root,
		config,
		{ fetch },
		() => {},
		() => {},
	)
	try {
		await production.remember(workId, projectDir)
		const session = await production.get(workId)
		assert.equal(session.snapshot().phase, 'confirm-visual')
		const { visual } = session.snapshot()
		assert.equal(visual?.characters.length, 1)
		await session.confirm({
			workId,
			mainVisualId: 'visual-1',
			characters: [
				{ characterId: 'ada', costumeId: 'uniform', candidateId: 'costume-1' },
			],
			supplementalIds: [],
		})
		await session.queue.idle()
		assert.equal(
			session.snapshot().phase,
			'confirm-first',
			JSON.stringify(session.snapshot()),
		)
		session.queue.continue(workId)
		await session.queue.idle()
		assert.equal(
			session.snapshot().blockedChapterId,
			'ch0002',
			JSON.stringify(session.snapshot()),
		)
		session.queue.retryChapter(workId, 'ch0002')
		await session.queue.idle()
		assert.equal(
			session.snapshot().phase,
			'done',
			JSON.stringify(session.snapshot()),
		)
		assert.ok(session.snapshot().chapters[1].issue)
		assert.ok(hits > 0, 'Expected exact matches from the existing art cassette')
		console.log(
			`Reused ${hits} existing art responses; added only synthetic gate responses.`,
		)
	} finally {
		await production.close()
	}
} finally {
	await rm(root, { recursive: true, force: true })
}
