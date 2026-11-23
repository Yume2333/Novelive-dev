import type { EventEnvelope } from '../contract'

export class EventReplay {
	private readonly entries: { event: EventEnvelope; bytes: number }[] = []
	private bytes = 0
	private droppedThrough = 0

	constructor(
		private readonly maxEntries = 256,
		private readonly maxBytes = 1024 * 1024,
	) {}

	append(event: EventEnvelope) {
		const bytes = Buffer.byteLength(JSON.stringify(event))
		if (bytes > this.maxBytes) {
			this.droppedThrough = event.seq
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
			this.droppedThrough = Math.max(this.droppedThrough, removed.event.seq)
		}
	}

	list(scopeId: string, afterSeq: number) {
		return {
			events: this.entries
				.filter(
					({ event }) => event.scopeId === scopeId && event.seq > afterSeq,
				)
				.map(({ event }) => event),
			gap: afterSeq < this.droppedThrough,
		}
	}
}
