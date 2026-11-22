import {
	type ClientFrame,
	type CreatorFrame,
	clientFrame,
} from '@novelive/creator/contract'

export function decodeClientFrame(json: string): ClientFrame | undefined {
	const input: unknown = JSON.parse(json)
	return clientFrame.check(input) ? input : undefined
}

export function encodeCreatorFrame(frame: CreatorFrame): string {
	return JSON.stringify(frame)
}
