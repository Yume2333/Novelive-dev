import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	type ChatEvent,
	type ChatOptions,
	ChatService,
	registerChat,
} from '../../../../packages/creator/src/chat'
import type {
	Command,
	CommandInput,
	CommandOutput,
} from '../../../../packages/creator/src/contract'
import {
	openProjectDatabase,
	ProjectTasks,
} from '../../../../packages/creator/src/project/database'
import { createRegistry } from '../../../../packages/creator/src/registry'

export const workId = 'f947f6e9-b854-4b16-b322-6aad47eb5df8'
export const model = {
	baseUrl: 'https://relay.invalid/v1',
	apiKey: 'offline-placeholder',
	format: 'openai-completions',
	model: 'devin-swe-2',
	contextWindow: 4096,
	compat: 'auto',
} as const
const syntheticModel = { ...model, maxOutputTokens: 1 } as const
export const image =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
export const prompts = {
	image: 'Describe this image in one sentence.',
	long: `Remember this motif: ${'paper boats. '.repeat(840)}`,
	plan: 'The next scene takes place at the bridge.',
	compact: `Keep the bridge scene focused. ${'No extra characters. '.repeat(80)}`,
	propose:
		'Call propose_adaptation_notes once. Set the adaptation notes to "Use present tense." Explain the reason as "Match the scene."',
	delegate: 'Ask the reviewer to check continuity using spawn_agent.',
}
export const rejectedReason = 'Keep the original narration tense.'

type Overrides = Partial<
	Pick<
		ChatOptions,
		'mainModel' | 'summaryModel' | 'replay' | 'emit' | 'onError'
	>
>
export async function createChatFixture(
	overrides: Overrides = {},
	beforeApply?: () => Promise<void>,
) {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-m2-chat-'))
	const path = join(directory, 'project.db')
	let db = openProjectDatabase(path, true)
	new ProjectTasks(db).registerWork({ workId, title: 'Paper Boats' })
	const events: ChatEvent['payload'][] = []
	const errors: unknown[] = []
	const pending = new Set<(event: ChatEvent['payload']) => void>()
	const work = { revision: 'r1', notes: 'Keep past tense.', writes: 0 }
	let chat: ChatService
	const registry = createRegistry()
	function connect() {
		chat = new ChatService({
			database: db,
			workId,
			cacheDir: join(directory, 'cache'),
			mainModel: () => syntheticModel,
			children: {
				reviewer: {
					model: () => syntheticModel,
					instructions: 'Review continuity. Do not make changes.',
				},
			},
			proposals: {
				async prepare(intent) {
					if (intent.kind !== 'requirements')
						throw new Error('Unexpected proposal')
					return {
						prompt: intent.reason,
						payload: {
							kind: 'requirements',
							expectedRevision: work.revision,
							previous: work.notes,
							next: intent.text,
						},
						chapterIds: ['ch0001'],
					}
				},
				async applyIfCurrent(proposal) {
					await beforeApply?.()
					if (proposal.payload.kind !== 'requirements')
						throw new Error('Unexpected proposal')
					if (
						proposal.payload.expectedRevision !== work.revision ||
						proposal.payload.previous !== work.notes
					)
						return { status: 'stale' }
					work.notes = proposal.payload.next
					work.revision = 'r-next'
					work.writes++
					return { status: 'applied' }
				},
			},
			replay: {
				directory: import.meta.dirname,
				mode: 'strict',
				delayMs: 12,
				fetch: async () => {
					throw new Error('Network forbidden')
				},
			},
			...overrides,
			emit(event) {
				events.push(structuredClone(event.payload))
				for (const callback of pending) callback(event.payload)
				overrides.emit?.(event)
			},
			onError(error) {
				errors.push(error)
				overrides.onError?.(error)
			},
		})
	}
	connect()
	registerChat(registry, (id) => {
		if (id !== workId)
			throw Object.assign(new Error('Unknown work'), { code: 'not_found' })
		return chat
	})
	function call<K extends Command>(command: K, input: CommandInput<K>) {
		return registry.run(
			command,
			input,
			new AbortController().signal,
		) as Promise<CommandOutput<K>>
	}
	function waitFor(
		match: (event: ChatEvent['payload']) => boolean,
		from = 0,
	): Promise<ChatEvent['payload']> {
		const event = events.slice(from).find(match)
		if (event) return Promise.resolve(event)
		return new Promise((resolve, reject) => {
			const finish = (event: ChatEvent['payload']) => {
				if (!match(event)) return
				clearTimeout(timer)
				pending.delete(finish)
				resolve(event)
			}
			const timer = setTimeout(() => {
				pending.delete(finish)
				reject(
					new Error('Timed out waiting for chat event', {
						cause: errors.at(-1),
					}),
				)
			}, 10_000)
			pending.add(finish)
		})
	}
	async function send(
		sessionId: string,
		text: string,
		parentId: string | null = null,
		attachmentIds: string[] = [],
	) {
		const { headId } = await call('chat.get', { workId, sessionId })
		if (!text) throw new Error('Fixture expects a nonempty prompt')
		return (
			await call('chat.send', {
				workId,
				sessionId,
				expectedHeadId: headId,
				parentId,
				content: { text, attachmentIds },
			})
		).headId
	}
	async function done(headId: string, from = 0) {
		const event = await waitFor(
			(event) => event.headId === headId && event.status !== 'streaming',
			from,
		)
		if (event.status === 'failed')
			throw errors.at(-1) ?? new Error('Chat failed')
		return event
	}
	return {
		call,
		send,
		waitFor,
		done,
		work,
		events,
		errors,
		async reopen() {
			await chat.close()
			db.close()
			db = openProjectDatabase(path, false)
			connect()
		},
		async close() {
			await chat.close()
			db.close()
			await rm(directory, { force: true, recursive: true })
		},
	}
}
