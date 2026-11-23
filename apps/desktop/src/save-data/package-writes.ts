export function packageProgressId(workId: string) {
	return `package:${workId}`
}

export class PackageWrites {
	private readonly stopped = new Set<string>()
	private readonly pending = new Map<string, Set<Promise<unknown>>>()

	run<T>(workId: string, operation: () => Promise<T>): Promise<T> {
		if (this.stopped.has(workId)) throw new Error('作品正在更新')
		let writes = this.pending.get(workId)
		if (!writes) {
			writes = new Set()
			this.pending.set(workId, writes)
		}
		const pending = operation().finally(() => {
			writes.delete(pending)
			if (!writes.size) this.pending.delete(workId)
		})
		writes.add(pending)
		return pending
	}

	async stopAndDrain(workIds: readonly string[]) {
		for (const id of workIds) this.stopped.add(id)
		await Promise.allSettled(
			workIds.flatMap((id) => [...(this.pending.get(id) ?? [])]),
		)
	}

	resume(workIds: readonly string[]) {
		for (const id of workIds) this.stopped.delete(id)
	}
}
