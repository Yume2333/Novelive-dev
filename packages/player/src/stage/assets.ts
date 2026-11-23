import { Assets, ExtensionType, extensions, Texture } from 'pixi.js'
import type { PlaybackBeat } from '../contract/playback'
import { assetLookahead, type PlayerResources } from '../contract/stage'

extensions.add({
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
			texture: Assets.load<Texture>({ src: url, loadParser: 'noveliveImage' }),
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
	constructor(private resources: PlayerResources) {}

	async sync(stage: readonly string[], upcoming: readonly string[]) {
		if (this.disposed) return
		const counts = new Map<string, number>()
		for (const id of [...stage, ...upcoming])
			counts.set(id, (counts.get(id) ?? 0) + 1)
		const results = await Promise.allSettled(
			[...counts].map(async ([id, references]) => {
				const entry = this.entries.get(id)
				if (entry) {
					entry.references = references
					return
				}
				try {
					const url = await this.resources.resolveAsset(id)
					const texture = await acquire(url)
					if (this.disposed) {
						await release(url)
						return
					}
					this.entries.set(id, { url, texture, references })
				} catch (error) {
					if (stage.includes(id)) throw error
				}
			}),
		)
		const failure = results.find((result) => result.status === 'rejected')
		if (failure?.status === 'rejected') throw failure.reason
		for (const [id, entry] of this.entries)
			if (!counts.has(id)) {
				this.entries.delete(id)
				await release(entry.url)
			}
	}

	get(id: string) {
		const entry = this.entries.get(id)
		if (!entry) throw new Error(`素材未预载：${id}`)
		return entry.texture
	}

	async destroy() {
		this.disposed = true
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
