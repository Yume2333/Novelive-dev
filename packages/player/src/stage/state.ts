import type { CompiledAction } from '@novelive/format/script'
import type { StageSlot, StageState } from '../contract/stage'

export const slotX = { left: 240, center: 480, right: 720 } as const

export function emptyStage(): StageState {
	return {
		background: null,
		sprites: {},
		cg: null,
		foreground: null,
		camera: {
			motion: 'reset',
			zoom: { scale: 1, target: 'stage' },
			shake: null,
		},
		particle: null,
		mask: null,
		filter: null,
		text: null,
	}
}

export function direct(state: StageState, action: CompiledAction): StageState {
	const next = structuredClone(state)
	const a = action.args
	const slot = a.slot as StageSlot
	const asset = action.assets[0]?.id ?? null
	switch (action.name) {
		case 'bg':
			if (asset !== next.background?.assetId)
				next.background = asset
					? {
							assetId: asset,
							transition:
								a.transition === 'none'
									? null
									: {
											fromAssetId: next.background?.assetId ?? null,
											name: String(a.transition),
											durationSeconds: Number(a.duration),
										},
						}
					: null
			break
		case 'cg':
			next.cg = asset
			break
		case 'fg':
			next.foreground = asset
			break
		case 'show':
			if (asset)
				next.sprites[slot] =
					next.sprites[slot]?.assetId.split('/')[0] === asset.split('/')[0]
						? { ...next.sprites[slot], assetId: asset }
						: {
								assetId: asset,
								position: slot,
								transform: {
									x: slotX[slot],
									y: 540,
									scaleX: 1,
									scaleY: 1,
									rotation: 0,
								},
								layer: Object.keys(slotX).indexOf(slot),
							}
			break
		case 'face':
		case 'costume':
			for (const item of action.assets) {
				for (const [key, sprite] of Object.entries(next.sprites)) {
					if (
						item.slot
							? key === item.slot
							: sprite.assetId.split('/')[0] === item.id.split('/')[0]
					)
						sprite.assetId = item.id
				}
			}
			break
		case 'hide':
			for (const [key, sprite] of Object.entries(next.sprites))
				if (
					Object.hasOwn(slotX, String(a.target))
						? key === a.target
						: sprite.assetId.split('/')[0] === a.target
				)
					delete next.sprites[key as StageSlot]
			break
		case 'move':
			if (next.sprites[slot])
				next.sprites[slot].transform.x = slotX[a.target as StageSlot]
			break
		case 'camera':
			next.camera.motion = a.motion as StageState['camera']['motion']
			if (a.motion === 'reset') next.camera.zoom = { scale: 1, target: 'stage' }
			break
		case 'zoom':
			next.camera.zoom = {
				scale: Number(a.scale),
				target: a.target as StageSlot | 'stage',
			}
			break
		case 'shake':
			next.camera.shake = { strength: Number(a.strength) }
			break
		case 'particle':
			next.particle =
				a.effect === 'none'
					? null
					: {
							effect: a.effect as 'rain' | 'snow' | 'sakura',
							intensity: Number(a.intensity),
							speed: Number(a.speed),
							angle: Number(a.angle),
						}
			break
		case 'mask':
			next.mask =
				a.shape === 'none'
					? null
					: {
							shape: a.shape as 'vignette' | 'letterbox',
							strength: Number(a.strength),
						}
			break
		case 'filter':
			next.filter =
				a.effect === 'none'
					? null
					: {
							effect: a.effect as 'blur' | 'brightness' | 'sepia' | 'glitch',
							value: Number(a.value),
						}
			break
	}
	return next
}

export function previewOpening(
	state: StageState,
	actions: readonly CompiledAction[],
): StageState {
	const final = JSON.stringify(actions.reduce(direct, state))
	return actions.reduce((opening, action) => {
		if (
			!['cg', 'fg'].includes(action.name) &&
			!(
				['bg', 'show', 'hide'].includes(action.name) &&
				action.args.transition === 'none'
			)
		)
			return opening
		const candidate = direct(opening, action)
		return JSON.stringify(actions.reduce(direct, candidate)) === final
			? candidate
			: opening
	}, state)
}

export function stageAssets(state: StageState): string[] {
	return [
		state.background?.assetId,
		state.cg,
		state.foreground,
		...Object.values(state.sprites).map((s) => s.assetId),
	].filter((id): id is string => Boolean(id))
}
