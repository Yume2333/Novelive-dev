import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
	TextModelError,
	testTextConnection,
} from '../../../packages/creator/src/models/text/index.js'
import { createReplayFetch } from '../../../packages/creator/src/replay/index.js'
import { smokeConnection, smokeProfiles } from './smoke-config.js'

const directory = 'tests/fixtures/text-models/synthetic'
await rm(join(directory, 'cassette.jsonl'), { force: true })

function event(type: string, data: object) {
	return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
}

const responsesMessage = {
	id: 'msg_fixture',
	type: 'message',
	role: 'assistant',
	status: 'completed',
	content: [{ type: 'output_text', text: 'OK', annotations: [] }],
}
const successfulResponses =
	event('response.output_item.done', {
		item: responsesMessage,
		output_index: 0,
	}) +
	event('response.completed', {
		response: {
			id: 'resp_fixture',
			status: 'completed',
			output: [responsesMessage],
			usage: { input_tokens: 12, output_tokens: 1, total_tokens: 13 },
		},
	})
const successfulMessages =
	event('message_start', {
		message: {
			id: 'msg_fixture',
			role: 'assistant',
			content: [],
			usage: { input_tokens: 12, output_tokens: 0 },
		},
	}) +
	event('content_block_start', {
		index: 0,
		content_block: { type: 'text', text: '' },
	}) +
	event('content_block_delta', {
		index: 0,
		delta: { type: 'text_delta', text: 'OK' },
	}) +
	event('content_block_stop', { index: 0 }) +
	event('message_delta', {
		delta: { stop_reason: 'end_turn' },
		usage: { output_tokens: 1 },
	}) +
	event('message_stop', {})

function completions(content: string, finishReason = 'stop') {
	return (
		[
			{
				choices: [
					{
						index: 0,
						delta: { role: 'assistant', content },
						finish_reason: null,
					},
				],
			},
			{ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
			{
				choices: [],
				usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
			},
		]
			.map(
				(chunk) =>
					`data: ${JSON.stringify({ id: 'chat_fixture', ...chunk })}\n\n`,
			)
			.join('') + 'data: [DONE]\n\n'
	)
}

const [chat, responses, messages] = smokeProfiles
const success = [
	{ profile: chat, body: completions('A single pixel.') },
	{ profile: responses, body: successfulResponses },
	{ profile: messages, body: successfulMessages },
]
const fixtures = [
	...success.map(({ profile, body }) => ({ profile, body, status: 200 })),
	{
		profile: { ...chat, model: 'fixture-auth' },
		body: { error: { code: 'invalid_api_key' } },
		status: 401,
	},
	{
		profile: { ...chat, model: 'fixture-missing' },
		body: { error: { code: 'model_not_found' } },
		status: 404,
	},
	{
		profile: { ...chat, model: 'fixture-moderation' },
		body: completions('', 'content_filter'),
		status: 200,
	},
	{
		profile: { ...chat, model: 'fixture-temporary' },
		body: { error: { code: 'service_unavailable' } },
		status: 400,
	},
	{
		profile: { ...chat, model: 'fixture-temporary' },
		body: completions('OK'),
		status: 200,
	},
	{
		profile: { ...chat, model: 'fixture-header-retry' },
		body: { error: { code: 'overloaded' } },
		status: 500,
	},
	{
		profile: { ...chat, model: 'fixture-header-retry' },
		body: { error: { code: 'rate_limit' } },
		status: 429,
	},
	{
		profile: { ...chat, model: 'fixture-header-retry' },
		body: completions('OK'),
		status: 200,
	},
	{
		profile: { ...chat, model: 'fixture-empty' },
		body: completions(''),
		status: 200,
	},
	{
		profile: { ...chat, model: 'fixture-empty' },
		body: completions('OK'),
		status: 200,
	},
]

for (const { profile, body, status } of fixtures) {
	const fetch = createReplayFetch({
		mode: 'record',
		directory,
		case: profile.model,
		tags: ['synthetic', 'not-a-provider-recording'],
		fetch: async () =>
			new Response(typeof body === 'string' ? body : JSON.stringify(body), {
				status,
				headers: {
					'content-type':
						typeof body === 'string' ? 'text/event-stream' : 'application/json',
					'retry-after': '0',
				},
			}),
	})
	try {
		await testTextConnection(
			smokeConnection(profile, 'https://relay.invalid', 'mock-key'),
			{
				image: profile.image,
				fetch,
				requestRetries: 0,
				streamRetries: 0,
			},
		)
	} catch (error) {
		if (
			!(error instanceof TextModelError) ||
			!['auth', 'not_found', 'moderation', 'network'].includes(error.code)
		)
			throw error
	}
}
