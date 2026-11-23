import {
	arr,
	compile,
	int,
	lit,
	map,
	nullable,
	num,
	obj,
	oneOf,
	opt,
	str,
	union,
} from '@earendil-works/pi-schema'
import { actionNames } from '../../../format/src/script/grammar'
import type {
	LegacySaveGroup,
	SaveEntry,
	SaveSlot,
	StageSnapshot,
	WorkProgress,
} from '../../../player/src/contract'

const id = str({ minLength: 1, maxLength: 256 })
const position = obj({ chapterId: id, sceneId: id, sentenceId: id })
const slot = union([
	obj({ kind: lit('quick') }),
	obj({ kind: lit('manual'), slot: int({ minimum: 1, maximum: 60 }) }),
])
const target = oneOf(['left', 'center', 'right', 'stage'])
const text = obj({
	kind: oneOf(['dialogue', 'inner', 'narration', 'caption']),
	speaker: opt(str()),
	displayName: opt(str()),
	content: arr(
		union([
			obj({ type: lit('text'), text: str() }),
			obj({ type: lit('open'), name: str(), argument: opt(str()) }),
			obj({ type: lit('close'), name: str() }),
			obj({ type: lit('pause'), seconds: num({ minimum: 0 }) }),
		]),
	),
})
const sprite = obj({
	assetId: id,
	position: oneOf(['left', 'center', 'right']),
	layer: num(),
	transform: obj({
		x: num(),
		y: num(),
		scaleX: num(),
		scaleY: num(),
		rotation: num(),
	}),
})
const snapshot = obj({
	position,
	stage: obj({
		background: nullable(
			obj({
				assetId: id,
				transition: nullable(
					obj({
						fromAssetId: nullable(id),
						name: str(),
						durationSeconds: num({ minimum: 0 }),
					}),
				),
			}),
		),
		sprites: obj({
			left: opt(sprite),
			center: opt(sprite),
			right: opt(sprite),
		}),
		cg: nullable(id),
		foreground: nullable(id),
		camera: obj({
			motion: oneOf(['sway', 'push-in', 'pull-out', 'reset']),
			zoom: obj({ scale: num(), target }),
			shake: nullable(obj({ strength: num() })),
		}),
		particle: nullable(
			obj({
				effect: oneOf(['rain', 'snow', 'sakura']),
				intensity: num(),
				speed: num(),
				angle: num(),
			}),
		),
		mask: nullable(
			obj({ shape: oneOf(['vignette', 'letterbox']), strength: num() }),
		),
		filter: nullable(
			obj({
				effect: oneOf(['blur', 'brightness', 'sepia', 'glitch']),
				value: num(),
			}),
		),
		text,
	}),
	active: arr(
		union([
			obj({ restore: lit('restart-text') }),
			obj({ restore: lit('skip-relative') }),
			obj({
				restore: lit('replay-state'),
				action: obj({
					type: lit('action'),
					line: int({ minimum: 1 }),
					col: int({ minimum: 1 }),
					name: oneOf(actionNames),
					args: map(union([str(), num()])),
					assets: arr(
						obj({ id, slot: opt(oneOf(['left', 'center', 'right'])) }),
					),
				}),
			}),
		]),
	),
})
const entry = obj({
	slot,
	savedAt: str(),
	snapshot,
	thumbnailRef: str({ pattern: '^[a-f0-9]{64}\\.webp$' }),
})
export const workProgressSchema = obj({
	mainline: nullable(position),
	read: arr(position),
	saves: arr(entry, { maxItems: 61 }),
})
export const workProgress = compile(workProgressSchema)
export const playerProgressRequest = compile(
	union([
		obj({ operation: lit('load'), workId: id }),
		obj({ operation: lit('save'), workId: id, progress: workProgressSchema }),
		obj({ operation: lit('thumbnail'), workId: id, slot }),
		obj({ operation: lit('listLegacy'), workId: id }),
		obj({
			operation: lit('deleteLegacy'),
			workId: id,
			version: int({ minimum: 1 }),
			slot,
		}),
		obj({
			operation: lit('saveSlot'),
			workId: id,
			slot,
			snapshot,
			rect: obj({
				x: int({ minimum: 0 }),
				y: int({ minimum: 0 }),
				width: int({ minimum: 1 }),
				height: int({ minimum: 1 }),
			}),
		}),
	]),
)

export const installedProgressKey = (workId: string, version: number) =>
	`package:${version}:${workId}`

export interface DesktopProgressApi {
	load(workId: string): Promise<WorkProgress | null>
	save(workId: string, progress: WorkProgress): Promise<void>
	saveSlot(
		workId: string,
		slot: SaveSlot,
		snapshot: StageSnapshot,
		rect: { x: number; y: number; width: number; height: number },
	): Promise<SaveEntry>
	thumbnail(workId: string, slot: SaveSlot): Promise<string>
	listLegacy?(workId: string): Promise<readonly LegacySaveGroup[]>
	deleteLegacy?(workId: string, version: number, slot: SaveSlot): Promise<void>
}
