import type { Beat, CompiledScene } from '@novelive/format/script'

export function createPlayback(
	scenes: readonly CompiledScene[],
	render: (beat: Beat | undefined) => Promise<void>,
	signal: AbortSignal,
	onError: (error: unknown) => void,
	textFinished?: () => Promise<void>,
	options: { startIndex?: number } = {},
) {
	const beats = scenes.flatMap((scene) => scene.beats)
	let index = (options.startIndex ?? 0) - 1
	let busy = false
	let stopped = false
	let timer: ReturnType<typeof setTimeout> | undefined
	signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
	async function advance() {
		if (busy || stopped || signal.aborted) return
		busy = true
		try {
			const beat = beats[++index]
			await render(beat)
			if (!beat) stopped = true
			if (!beat || signal.aborted || beat.advance.kind === 'click') return
			await textFinished?.()
			if (signal.aborted) return
			const delay =
				beat.advance.kind === 'delay'
					? beat.advance.seconds * 1000
					: !textFinished && beat.line?.type === 'text'
						? 2000
						: 0
			timer = setTimeout(() => void advance(), delay)
		} catch (error) {
			stopped = true
			onError(error)
		} finally {
			busy = false
		}
	}
	return {
		start: advance,
		click: () => {
			if (beats[index]?.advance.kind === 'click') void advance()
		},
	}
}
