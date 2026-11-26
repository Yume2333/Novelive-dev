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
	opt,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import {
	configErrorSchema,
	configUpdateSchema,
	maskedConfigSchema,
	textCatalogSchema,
} from '../config/schema'
import { usageCommands } from '../usage/contract'
import { chatCommands } from './chat'
import { editorCommands } from './editor'
import { importCommands } from './import'
import type { DesktopProgressApi } from './player-progress'
import { productionCommands } from './production'
import type { DesktopShareApi } from './share'

export {
	type ConfigUpdate,
	type MaskedConfig,
	type ProductionRole,
	type ProductionSettings,
	roleModelDefaults,
	type TextSlot,
	type WriterPreset,
	type WriterSettings,
} from '../config/schema'
export * from './chat'
export * from './editor'
export * from './errors'
export * from './import'
export { installedProgressKey } from './player-progress'
export * from './production'
export { type ProjectErrorCode, projectErrorCodes } from './project'
export * from './queue'
export * from './share'

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
		'context_limit',
		'reasoning_limit',
		'stale_revision',
		'cancelled',
		'creator_down',
		'internal',
	]),
	message: str(),
})
const imageCapability = union([
	obj({ ok: lit(true), path: str(), thumbnail: str() }),
	obj({ ok: lit(false), error }),
])

export const commands = {
	...usageCommands,
	...chatCommands,
	...editorCommands,
	...productionCommands,
	...importCommands,
	'library.list': {
		input: empty,
		output: obj({
			works: arr(
				obj({
					workId: str(),
					title: str(),
					published: int(),
					chapters: int(),
					project: opt(
						obj({
							directory: str(),
							seriesId: str(),
							seriesTitle: str(),
							volumeId: str(),
							volumeTitle: str(),
							volumeIndex: int({ minimum: 1 }),
						}),
					),
				}),
			),
			unreadableCount: int(),
		}),
	},
	'config.get': {
		input: empty,
		output: union([maskedConfigSchema, configErrorSchema]),
	},
	'config.update': { input: configUpdateSchema, output: maskedConfigSchema },
	'config.reset': { input: empty, output: maskedConfigSchema },
	'model.suggestContextWindow': {
		input: textCatalogSchema,
		output: nullable(int({ minimum: 4096 })),
	},
	'model.testText': {
		input: obj({ slot: oneOf(['fast', 'main', 'writing', 'visual']) }),
		output: obj({ ok: lit(true) }),
	},
	'model.testImage': {
		input: empty,
		output: obj({
			generate: imageCapability,
			transparent: imageCapability,
			edit: imageCapability,
		}),
	},
	'events.list': {
		input: obj({ scope, scopeId: str(), afterSeq: int({ minimum: 0 }) }),
		output: obj({
			events: arr(envelope),
			gap: bool(),
			snapshot: nullable(appSnapshot),
		}),
	},
	'debug.sqliteSmoke': {
		input: empty,
		output: obj({ ok: bool(), journalMode: lit('wal'), value: int() }),
	},
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
export function creatorCommandError(error: unknown): CommandError {
	const failure =
		error instanceof Error && 'code' in error
			? { code: error.code, message: error.message }
			: error
	return commandError.check(failure)
		? failure
		: { code: 'internal', message: '创作端命令失败' }
}
export type ClientFrame = Static<typeof clientSchema>
export type CreatorFrame = Static<typeof creatorSchema>

export interface HostState {
	creator: 'starting' | 'ready' | 'down' | 'failed'
	generation: number
	breakerOpen: boolean
	logDir: string
	homeDir: string
}

export interface NoveliveEvents {
	'creator.ready': { generation: number }
	'creator.down': { generation: number }
	event: EventEnvelope
	'package.open': undefined
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
	pickFiles(kind: 'source' | 'txt' | 'image' | 'package'): Promise<string[]>
	pickPackageDestination?(): Promise<string | null>
	host: {
		progress?: DesktopProgressApi
		share?: DesktopShareApi
		installed?: {
			list(): Promise<
				{
					workId: string
					title: string
					version: number
					chapters: number
					published: number
				}[]
			>
			chapter(
				workId: string,
				version: number,
				chapterId?: string,
			): Promise<CommandOutput<'production.playerChapter'>>
			takeOpenFile(): Promise<string | null>
		}
		about?: {
			info(): Promise<{ version: string; packaged: boolean }>
			open(kind: 'license' | 'notices' | 'source'): Promise<void>
			checkUpdates(): Promise<void>
		}
		appState(): Promise<HostState>
		openLogDir(): Promise<void>
		restartCreator(): Promise<void>
	}
}
