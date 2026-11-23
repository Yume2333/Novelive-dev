import type { EventEnvelope } from '../contract'

export class EventReplay {
	private readonly entries: { event: EventEnvelope; bytes: number }[] = []
	private bytes = 0
	private readonly droppedThrough = new Map<string, number>()
	private readonly droppedChapters = new Map<number, string>()

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
		if (event.event.type === 'production.chapterRecord') {
			this.droppedChapters.set(event.seq, key)
			if (this.droppedChapters.size > this.maxEntries) {
				const oldest = this.droppedChapters.entries().next().value
				if (oldest) {
					const [seq, scope] = oldest
					this.droppedChapters.delete(seq)
					this.droppedThrough.set(
						scope,
						Math.max(this.droppedThrough.get(scope) ?? 0, seq),
					)
				}
			}
			return
		}
		this.droppedThrough.set(
			key,
			Math.max(this.droppedThrough.get(key) ?? 0, event.seq),
		)
	}

	list(
		scopeId: string,
		afterSeq: number,
		scope: EventEnvelope['scope'] = 'work',
		records: readonly EventEnvelope[] = [],
	) {
		const matches = (event: EventEnvelope) =>
			event.scope === scope && event.scopeId === scopeId && event.seq > afterSeq
		const merged = new Map<number, EventEnvelope>()
		for (const event of records)
			if (matches(event)) merged.set(event.seq, event)
		for (const { event } of this.entries)
			if (matches(event)) merged.set(event.seq, event)
		const key = JSON.stringify([scope, scopeId])
		let chapterGap = false
		for (const [seq, droppedScope] of this.droppedChapters) {
			if (droppedScope === key && seq > afterSeq && !merged.has(seq)) {
				chapterGap = true
				break
			}
		}
		return {
			events: [...merged.values()].sort((a, b) => a.seq - b.seq),
			gap: afterSeq < (this.droppedThrough.get(key) ?? 0) || chapterGap,
		}
	}
}
