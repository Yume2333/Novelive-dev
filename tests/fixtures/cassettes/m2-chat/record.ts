import { appendFile } from 'node:fs/promises'
import {
	createChatFixture,
	image,
	model,
	prompts,
	rejectedReason,
	workId,
} from './fixture'

const directory = process.env.NL_CASSETTE_DIR
const baseUrl = process.env.NL_IMAGE_BASE_URL
const apiKey = process.env.NL_IMAGE_API_KEY
const usage = process.env.NL_USAGE_CSV
if (
	process.env.NL_REPLAY !== 'record' ||
	!directory ||
	!baseUrl ||
	!apiKey ||
	!usage
)
	throw new Error(
		'Coordinator recording requires private NL_CASSETTE_DIR and NL_USAGE_CSV paths, NL_REPLAY=record, and the provisioned relay',
	)
const endpoint = new URL(baseUrl)
if (endpoint.pathname === '/') endpoint.pathname = '/v1'
let calls = 0
const fetch: typeof globalThis.fetch = async (input, init) => {
	if (calls >= 8) throw new Error('M2 chat recording limit reached')
	calls++
	// Reserve the model window before each call, including failed calls.
	await appendFile(
		usage,
		`${new Date().toISOString().slice(0, 10)},${model.model},1,${model.contextWindow},0,M2/03 chat recording (reserved upper bound)\n`,
	)
	return globalThis.fetch(input, init)
}
const chat = await createChatFixture({
	mainModel: () => ({ ...model, baseUrl: endpoint.href, apiKey }),
	replay: {
		directory,
		fetch,
		case: 'm2-chat',
		tags: ['provider-recording', 'synthetic-source'],
	},
})
try {
	const imageSession = (await chat.call('chat.create', { workId })).session
		.sessionId
	const attachment = await chat.call('chat.attach', {
		workId,
		sessionId: imageSession,
		name: 'gray.png',
		mimeType: 'image/png',
		base64: image,
	})
	await chat.done(
		await chat.send(imageSession, prompts.image, null, [attachment.id]),
	)

	const summarySession = (await chat.call('chat.create', { workId })).session
		.sessionId
	const first = await chat.send(summarySession, prompts.long)
	await chat.done(first)
	const second = await chat.send(summarySession, prompts.plan, first)
	await chat.done(second)
	await chat.done(await chat.send(summarySession, prompts.compact, second))

	const proposalSession = (await chat.call('chat.create', { workId })).session
		.sessionId
	const headId = await chat.send(proposalSession, prompts.propose)
	const { message } = await chat.done(headId)
	const card = message.parts.find((part) => part.type === 'proposal')
	if (!card) throw new Error('No adaptation notes proposal returned')
	const from = chat.events.length
	await chat.call('proposal.resolve', {
		workId,
		proposalId: card.proposal.id,
		decision: { kind: 'reject', reason: rejectedReason },
	})
	await chat.done(headId, from)
	console.log(`Recorded ${calls} M2 chat calls.`)
} catch {
	console.error(
		`M2 chat recording stopped after ${calls} calls. Check the private cassette for the last completed request.`,
	)
	process.exitCode = 1
} finally {
	await chat.close()
}
