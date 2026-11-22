import {
	type ClientFrame,
	type CreatorFrame,
	clientFrame,
	type HostState,
} from '@novelive/creator/contract'

export function decodeClientFrame(json: string): ClientFrame | undefined {
	try {
		const input: unknown = JSON.parse(json)
		return clientFrame.check(input) ? input : undefined
	} catch {
		return undefined
	}
}

export function encodeCreatorFrame(frame: CreatorFrame): string {
	return JSON.stringify(frame)
}

export type HostFrame = {
	type: 'host'
	op: 'openLogDir' | 'restartCreator'
	requestId: number
}

export type HostMessage =
	| { type: 'state'; state: HostState }
	| { type: 'hostResult'; requestId: number }
	| { type: 'hostError'; requestId: number; message: string }
