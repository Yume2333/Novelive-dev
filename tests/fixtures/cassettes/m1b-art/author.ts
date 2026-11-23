import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Project } from '../../../../packages/creator/src/project'
import {
	directorResult,
	directory,
	picture,
	projectSeed,
	runArt,
	runFailures,
} from './fixture'

// Synthetic JSON and SSE generated in-process; never contacts a provider.
const fetch: typeof globalThis.fetch = async (input, init) => {
	const request = new Request(input, init)
	const url = new URL(request.url)
	assert.equal(url.origin, 'https://relay.invalid')
	if (url.pathname.startsWith('/v1/images/')) {
		const form = url.pathname.endsWith('/edits')
			? await request.formData()
			: undefined
		const body = form ? Object.fromEntries(form) : await request.json()
		assert.equal(body.quality, 'medium')
		const [width, height] = body.size.split('x').map(Number)
		const transparent = body.background === 'transparent'
		if (transparent) assert.equal(body.output_format, 'png')
		if (body.model === 'fixture-art-unsupported')
			return Response.json(
				{
					error: {
						code: 'unsupported_parameter',
						message: 'size not supported',
					},
				},
				{ status: 400 },
			)
		if (body.model === 'fixture-art-moderation')
			return Response.json(
				{ error: { code: 'moderation_blocked', message: 'moderation' } },
				{ status: 400 },
			)
		if (body.model === 'fixture-art-bad-image')
			return Response.json({ data: [{ b64_json: 'bm90IGFuIGltYWdl' }] })
		if (body.prompt.includes('Edit only')) {
			assert.ok(form)
			assert.match(body.prompt, /Images 2–3 are style references/)
			assert.match(body.prompt, /Image 1 is the .* base image/)
		}
		if (body.prompt.includes('previous costume base image')) {
			assert.match(
				body.prompt,
				/Image 3 is the ada\/uniform\/neutral previous costume base image/,
			)
			assert.match(body.prompt, /identity reference for the subject/)
			assert.match(body.prompt, /not the style reference’s pose or silhouette/)
		}
		if (
			body.prompt.includes('Draw a full scene') &&
			body.prompt.includes('Ada:')
		) {
			assert.ok(form)
			assert.match(
				body.prompt,
				/Image 3 is the ada\/uniform\/neutral costume base image/,
			)
			assert.match(body.prompt, /Image 4 is the room\/day location base image/)
			assert.match(body.prompt, /black hair, blue eyes, blue uniform/)
		}
		return Response.json({
			data: [
				{
					b64_json: (await picture(width, height, transparent)).toString(
						'base64',
					),
				},
			],
		})
	}
	assert.equal(url.pathname, '/v1/chat/completions')
	const body = await request.json()
	const content = body.messages[0].content
	const prompt: string = typeof content === 'string' ? content : content[0].text
	const result = prompt.startsWith('You are the art director')
		? directorResult
		: prompt.startsWith('Visually audit')
			? body.model === 'fixture-art-visual-fail'
				? { pass: false, failedChecks: ['anchors'], feedback: '发卡缺失' }
				: { pass: true, failedChecks: [], feedback: '' }
			: {
					content: prompt.includes('收敛描写')
						? '柔和的窗光照进房间。'
						: '窗光从中央照进来。',
				}
	return new Response(
		`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: null }] })}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`,
		{
			headers: { 'content-type': 'text/event-stream' },
		},
	)
}

const replay = {
	directory,
	mode: 'record',
	fetch,
	case: 'm1b-art',
	tags: ['synthetic', 'not-a-provider-recording'],
} as const
const path = await mkdtemp(join(homedir(), '.m1b-art-author-'))
try {
	await rm(join(directory, 'cassette.jsonl'), { force: true })
	await rm(join(directory, 'cassette-files'), { recursive: true, force: true })
	using success = await Project.create(join(path, 'success'), {
		...projectSeed,
		volumeIds: ['v1'],
	})
	await runArt(success, replay)
	using failures = await Project.create(join(path, 'failures'), {
		...projectSeed,
		volumeIds: ['v1'],
	})
	await runFailures(failures, replay)
} finally {
	await rm(path, { recursive: true, force: true })
}
