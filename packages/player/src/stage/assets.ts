import { Assets, ExtensionType, extensions, Texture } from 'pixi.js'
import type { PlaybackBeat } from '../contract/playback'
import { assetLookahead, type PlayerResources } from '../contract/stage'

extensions.add({
	id: 'noveliveImage',
	extension: { type: ExtensionType.LoadParser, name: 'noveliveImage' },
	async load(url: string) {
		const image = new Image()
		image.crossOrigin = 'anonymous'
		image.src = url
		await image.decode()
		return Texture.from(image, true)
	},
	unload(texture: Texture) {
		texture.destroy(true)
	},
})

const shared = new Map<
	string,
	{ texture: Promise<Texture>; references: number }
>()

async function acquire(url: string) {
	let entry = shared.get(url)
	if (!entry) {
		entry = {
			texture: Assets.load<Texture>({ src: url, parser: 'noveliveImage' }),
			references: 0,
		}
		shared.set(url, entry)
	}
	entry.references++
	try {
		return await entry.texture
	} catch (error) {
		if (--entry.references === 0) shared.delete(url)
		throw error
	}
}

async function release(url: string) {
	const entry = shared.get(url)
	if (!entry || --entry.references > 0) return
	shared.delete(url)
	const texture = await entry.texture
	await Assets.unload(url)
	if (!texture.destroyed) texture.destroy(true)
}

export class AssetWindow {
	private entries = new Map<
		string,
		{ url: string; texture: Texture; references: number }
	>()
	private disposed = false
	private pending = new Map<string, Promise<void>>()
	private wanted = new Map<string, number>()
	constructor(private resources: PlayerResources) {}

	async sync(stage: readonly string[], upcoming: readonly string[]) {
		if (this.disposed) return
		const counts = new Map<string, number>()
		for (const id of [...stage, ...upcoming])
			counts.set(id, (counts.get(id) ?? 0) + 1)
		this.wanted = counts
		const load = (id: string): Promise<void> => {
			const pending = this.pending.get(id)
			if (pending) return pending
			const request = (async () => {
				const entry = this.entries.get(id)
				if (entry) {
					entry.references = counts.get(id) ?? 0
					return
				}
				try {
					const url = await this.resources.resolveAsset(id)
					const texture = await acquire(url)
					if (this.disposed || !this.wanted.has(id)) {
						await release(url)
						return
					}
					this.entries.set(id, {
						url,
						texture,
						references: this.wanted.get(id) ?? 0,
					})
				} finally {
					this.pending.delete(id)
				}
			})()
			if (!this.entries.has(id)) this.pending.set(id, request)
			void request.catch(() => {})
			return request
		}
		const current = stage.map(load)
		for (const id of upcoming) void load(id)
		for (const [id, entry] of this.entries)
			if (!counts.has(id)) {
				this.entries.delete(id)
				await release(entry.url)
			}
		await Promise.all(current)
	}

	get(id: string) {
		const entry = this.entries.get(id)
		if (!entry) throw new Error(`素材未预载：${id}`)
		return entry.texture
	}

	async destroy() {
		this.disposed = true
		await Promise.allSettled(this.pending.values())
		const entries = [...this.entries.values()]
		this.entries.clear()
		await Promise.all(entries.map((entry) => release(entry.url)))
	}
}

export function lookahead(
	beats: readonly PlaybackBeat[],
	index: number,
	size: number = assetLookahead.default,
): string[] {
	const result: string[] = []
	let sentences = 0
	for (const beat of beats.slice(index)) {
		if (
			beat.cue.kind === 'text' &&
			++sentences >
				Math.max(assetLookahead.minimum, Math.min(assetLookahead.default, size))
		)
			break
		result.push(
			...beat.actions.flatMap((action) =>
				action.assets.map((asset) => asset.id),
			),
		)
	}
	return result
}
