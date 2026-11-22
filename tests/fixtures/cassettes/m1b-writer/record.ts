import { appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import {
	contextWindow,
	fixtureOptions,
	reviewer,
	runRecording,
	writer,
} from './fixture'

const baseUrl = process.env.NL_IMAGE_BASE_URL
const apiKey = process.env.NL_IMAGE_API_KEY
if (process.env.NL_REPLAY !== 'record' || !baseUrl || !apiKey)
	throw new Error(
		'Recording requires NL_REPLAY=record and the provisioned relay environment',
	)
const endpoint = new URL(baseUrl)
if (endpoint.pathname === '/') endpoint.pathname = '/v1'
const usagePath = join(homedir(), 'memory/poke_5b9601/files/novelive/usage.csv')
const maxCalls = 16
let calls = 0
let tokens = 0
let estimates = 0

const fetch: typeof globalThis.fetch = async (input, init) => {
	const request = new Request(input, init)
	const body = await request.clone().json()
	const model = body.model
	if (model !== writer && model !== reviewer)
		throw new Error('Unexpected recording model')
	if (++calls > maxCalls) throw new Error('Recording call allocation reached')
	let total: number | undefined
	try {
		const response = await globalThis.fetch(request)
		for (const line of (await response.clone().text()).split('\n')) {
			if (!line.startsWith('data:') || line.includes('[DONE]')) continue
			const event = JSON.parse(line.slice(5))
			const usage = event.usage
			const measured =
				usage?.total_tokens ?? usage?.prompt_tokens + usage?.completion_tokens
			if (Number.isSafeInteger(measured) && measured > 0) total = measured
		}
		return response
	} finally {
		tokens += total ?? contextWindow
		if (total === undefined) estimates++
		await appendFile(
			usagePath,
			`${new Date().toISOString().slice(0, 10)},${model},1,${total ?? contextWindow},0,M1b/02 synthetic writer replay${total === undefined ? ' (reserved upper bound)' : ''}\n`,
		)
	}
}

try {
	const result = await runRecording(
		fixtureOptions(
			createReplayFetch({
				directory: import.meta.dirname,
				fetch,
				case: 'm1b-writer',
				tags: ['provider-recording', 'synthetic-source'],
			}),
			{ baseUrl: endpoint.href, apiKey },
		),
	)
	console.log(
		`Recorded ${result.scenes.length} scene(s), ${result.fidelity.length} fidelity issues.`,
	)
} catch (error) {
	console.error(
		`Writer recording failed (${error instanceof Error ? error.name : 'unknown error'}).`,
	)
	process.exitCode = 1
} finally {
	console.log(
		`Paid usage: ${Math.min(calls, maxCalls)} calls, ${tokens} tokens (${estimates} estimated), 0 images.`,
	)
}
