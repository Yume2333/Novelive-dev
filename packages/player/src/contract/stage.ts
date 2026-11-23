import type { CompiledAction } from '@novelive/format/script'
import type { PlayerText, SentenceRef } from './playback'

export type AssetId = CompiledAction['assets'][number]['id']
export type StageSlot = NonNullable<CompiledAction['assets'][number]['slot']>

export const assetLookahead = { minimum: 20, default: 32 } as const

export interface PlayerResources {
	resolveAsset(assetId: AssetId): string | Promise<string>
}

export interface SpriteState {
	assetId: AssetId
	position: StageSlot
	transform: {
		x: number
		y: number
		scaleX: number
		scaleY: number
		rotation: number
	}
	layer: number
}

export interface StageState {
	background: {
		assetId: AssetId
		transition: {
			fromAssetId: AssetId | null
			name: string
			durationSeconds: number
		} | null
	} | null
	sprites: Partial<Record<StageSlot, SpriteState>>
	cg: AssetId | null
	foreground: AssetId | null
	camera: {
		motion: 'sway' | 'push-in' | 'pull-out' | 'reset'
		zoom: { scale: number; target: StageSlot | 'stage' }
		shake: { strength: number } | null
	}
	particle: {
		effect: 'rain' | 'snow' | 'sakura'
		intensity: number
		speed: number
		angle: number
	} | null
	mask: { shape: 'vignette' | 'letterbox'; strength: number } | null
	filter: {
		effect: 'blur' | 'brightness' | 'sepia' | 'glitch'
		value: number
	} | null
	text: PlayerText | null
}

export type ActivePerformance =
	| { restore: 'replay-state'; action: CompiledAction }
	| { restore: 'restart-text' }
	| { restore: 'skip-relative' }

export interface StageSnapshot {
	position: SentenceRef
	stage: StageState & { text: PlayerText }
	active: readonly ActivePerformance[]
}
