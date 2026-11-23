import type { EventEnvelope } from '../contract'

export class EventReplay {
	private readonly entries: { event: EventEnvelope; bytes: number }[] = []
	private bytes = 0
	private readonly droppedThrough = new Map<string, number>()

	constructor(
		private readonly maxEntries = 256,
		private readonly maxBytes = 1024 * 1024,
	) {}

	append(event: EventEnvelope) {
		const bytes = Buffer.byteLength(JSON.stringify(event))
		if (bytes > this.maxBytes) {
			this.dropped(event)
			return
		}
		this.entries.push({ event, bytes })
		this.bytes += bytes
		while (
			this.entries.length > this.maxEntries ||
			this.bytes > this.maxBytes
		) {
			const removed = this.entries[0]
			this.entries.shift()
			this.bytes -= removed.bytes
			this.dropped(removed.event)
		}
	}

	private dropped(event: EventEnvelope) {
		const key = JSON.stringify([event.scope, event.scopeId])
		this.droppedThrough.set(
			key,
			Math.max(this.droppedThrough.get(key) ?? 0, event.seq),
		)
	}

	list(
		scopeId: string,
		afterSeq: number,
		scope: EventEnvelope['scope'] = 'work',
	) {
		return {
			events: this.entries
				.filter(
					({ event }) =>
						event.scope === scope &&
						event.scopeId === scopeId &&
						event.seq > afterSeq,
				)
				.map(({ event }) => event),
			gap:
				afterSeq <
				(this.droppedThrough.get(JSON.stringify([scope, scopeId])) ?? 0),
		}
	}
}
