import {
	unknown as anyValue,
	arr,
	bool,
	compile,
	int,
	lit,
	nullable,
	obj,
	oneOf,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'

const generation = int({ minimum: 1 })
const scope = oneOf(['app', 'work'])
const requestId = int({ minimum: 1 })
const empty = obj({})
const appSnapshot = obj({ ready: bool(), generation })
const envelope = obj({
	seq: int({ minimum: 1 }),
	scope,
	scopeId: str(),
	at: str(),
	event: obj({ type: str(), payload: anyValue() }),
})
const error = obj({
	code: oneOf([
		'auth',
		'not_found',
		'unsupported',
		'network',
		'moderation',
		'invalid_config',
		'cancelled',
		'creator_down',
		'internal',
	]),
	message: str(),
})

export const commands = {
	'events.list': {
		input: obj({ scope, scopeId: str(), afterSeq: int({ minimum: 0 }) }),
		output: obj({
			events: arr(envelope),
			gap: bool(),
			snapshot: nullable(appSnapshot),
		}),
	},
	'debug.sqliteSmoke': { input: empty, output: obj({ ok: bool() }) },
	'debug.sharpSmoke': { input: empty, output: obj({ ok: bool() }) },
}

export type Command = keyof typeof commands
export type CommandInput<K extends Command> = Static<
	(typeof commands)[K]['input']
>
export type CommandOutput<K extends Command> = Static<
	(typeof commands)[K]['output']
>
export type CommandError = Static<typeof error>
export type EventEnvelope = Static<typeof envelope>

const clientSchema = union([
	obj({
		type: lit('call'),
		generation,
		requestId,
		command: str(),
		payload: anyValue(),
	}),
	obj({ type: lit('cancel'), generation, requestId }),
])

const creatorSchema = union([
	obj({ type: lit('result'), generation, requestId, result: anyValue() }),
	obj({ type: lit('error'), generation, requestId, error }),
	obj({ type: lit('event'), generation, envelope }),
])

export const clientFrame = compile(clientSchema)
export const creatorFrame = compile(creatorSchema)
export const commandError = compile(error)
export type ClientFrame = Static<typeof clientSchema>
export type CreatorFrame = Static<typeof creatorSchema>

export interface HostState {
	creator: 'starting' | 'ready' | 'down' | 'failed'
	generation: number
	breakerOpen: boolean
	logDir: string
}

export interface NoveliveEvents {
	'creator.ready': { generation: number }
	'creator.down': { generation: number }
	event: EventEnvelope
}

export interface Novelive {
	call<K extends Command>(
		command: K,
		payload: CommandInput<K>,
	): {
		promise: Promise<CommandOutput<K>>
		cancel(): void
	}
	on<K extends keyof NoveliveEvents>(
		event: K,
		handler: (payload: NoveliveEvents[K]) => void,
	): () => void
	resourceUrl(path: string): string
	pickFolder(): Promise<string | null>
	host: {
		appState(): Promise<HostState>
		openLogDir(): Promise<void>
		restartCreator(): Promise<void>
	}
}
