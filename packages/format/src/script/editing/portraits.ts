import type { Beat, CompiledAction, CompiledScene } from '../compile'
import { slots } from '../grammar'

type Portrait = { id: string; action: CompiledAction }

export function portraitsAt(scenes: readonly CompiledScene[], target: Beat) {
	const portraits = new Map<string, Portrait>()
	for (const { beats } of scenes) {
		for (const beat of beats) {
			for (const action of beat.actions) {
				const { name, args, assets } = action
				switch (name) {
					case 'show':
						portraits.set(String(args.slot), { id: assets[0].id, action })
						break
					case 'hide':
						if (slots.some((slot) => slot === args.target))
							portraits.delete(String(args.target))
						else
							for (const [slot, { id }] of portraits)
								if (id.split('/')[0] === args.target) portraits.delete(slot)
						break
					case 'move': {
						const from = String(args.slot)
						const portrait = portraits.get(from)
						portraits.delete(from)
						if (portrait) portraits.set(String(args.target), portrait)
						break
					}
					case 'face':
					case 'costume':
						for (const { id, slot } of assets) {
							for (const [position, portrait] of portraits) {
								if (
									slot
										? position === slot
										: id.split('/')[0] === portrait.id.split('/')[0]
								)
									portraits.set(position, { id, action })
							}
						}
						break
				}
			}
			if (beat === target) return portraits
		}
	}
	return portraits
}
