import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { picture } from '../m1b-art/fixture'
import {
	directory,
	instruction,
	rewritten,
	rule,
	runRevisions,
} from './fixture'

function sse(content: string) {
	return new Response(
		`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`,
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}

let rewrites = 0
// Synthetic SSE and images generated in-process; never contacts a provider.
const fetch: typeof globalThis.fetch = async (input, init) => {
	const request = new Request(input, init)
	const url = new URL(request.url)
	assert.equal(url.origin, 'https://relay.invalid')
	if (url.pathname.startsWith('/v1/images/')) {
		const form = url.pathname.endsWith('/edits')
			? await request.formData()
			: undefined
		const body = form ? Object.fromEntries(form) : await request.json()
		const [width, height] = String(body.size).split('x').map(Number)
		return Response.json({
			data: [
				{
					b64_json: (
						await picture(width, height, body.background === 'transparent')
					).toString('base64'),
				},
			],
		})
	}
	assert.equal(url.pathname, '/v1/chat/completions')
	const body = await request.json()
	const content = body.messages[0].content
	const prompt: string = typeof content === 'string' ? content : content[0].text
	if (prompt.includes('Rewrite this existing scene')) {
		assert.match(
			prompt,
			new RegExp(`Creator rewrite instruction: ${instruction}`),
		)
		assert.match(prompt, /暮色中，一只纸船从桥下漂过。/)
		// The chapter rule is saved between the two rewrites; only the later one sees it.
		assert.equal(prompt.includes(rule), ++rewrites === 2)
		return sse(rewritten)
	}
	if (prompt.startsWith('Visually audit'))
		return sse(JSON.stringify({ pass: true, failedChecks: [], feedback: '' }))
	return sse(JSON.stringify({ content: '柔和的暮光照着 Ada。' }))
}

const path = await mkdtemp(join(homedir(), '.m2-revisions-author-'))
try {
	await rm(join(directory, 'cassette.jsonl'), { force: true })
	await rm(join(directory, 'cassette-files'), { recursive: true, force: true })
	const { project } = await runRevisions(path, {
		directory,
		mode: 'record',
		fetch,
		case: 'm2-revisions',
		tags: ['synthetic', 'not-a-provider-recording'],
	})
	project.close()
	assert.equal(rewrites, 2)
} finally {
	await rm(path, { recursive: true, force: true })
}
