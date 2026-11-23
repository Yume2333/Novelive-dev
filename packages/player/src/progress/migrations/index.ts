import type {
	AssetId,
	ProgressMigrationInput,
	ProgressMigrationResult,
	SaveEntry,
	SentenceRef,
	StageSnapshot,
} from '../../contract'
import { emptyStage } from '../../stage/state'
import { sentenceKey } from '..'

function migrateSnapshot(
	snapshot: StageSnapshot,
	assets: ReadonlySet<AssetId>,
): StageSnapshot {
	const defaults = emptyStage()
	const stage = snapshot.stage
	const { background, cg, foreground, sprites } = stage ?? defaults
	const transition = background?.transition
	return {
		...snapshot,
		active: (snapshot.active ?? []).filter(
			(active) =>
				active.restore !== 'replay-state' ||
				active.action.assets.every(({ id }) => assets.has(id)),
		),
		stage: {
			...defaults,
			...stage,
			background:
				background && assets.has(background.assetId)
					? {
							...background,
							transition: transition
								? {
										...transition,
										fromAssetId:
											transition.fromAssetId &&
											assets.has(transition.fromAssetId)
												? transition.fromAssetId
												: null,
									}
								: null,
						}
					: null,
			cg: cg && assets.has(cg) ? cg : null,
			foreground: foreground && assets.has(foreground) ? foreground : null,
			sprites: Object.fromEntries(
				Object.entries(sprites ?? {}).filter(([, sprite]) =>
					assets.has(sprite.assetId),
				),
			),
			camera: {
				...defaults.camera,
				...stage?.camera,
				zoom: { ...defaults.camera.zoom, ...stage?.camera?.zoom },
			},
			text: {
				...stage?.text,
				kind: stage?.text?.kind ?? 'narration',
				content: stage?.text?.content ?? [],
			},
		},
	}
}

export function migrateProgress(
	{
		fromVersion,
		toVersion,
		positions,
		progress,
		legacySaves,
	}: ProgressMigrationInput,
	assetIds: readonly AssetId[],
): ProgressMigrationResult {
	if (toVersion <= fromVersion)
		return structuredClone({ progress, legacySaves })

	const valid = new Set(positions.map(sentenceKey))
	const assets = new Set(assetIds)
	const matches = (position: SentenceRef) => valid.has(sentenceKey(position))
	const saves: SaveEntry[] = []
	const archived: SaveEntry[] = []
	for (const entry of progress.saves) {
		if (matches(entry.snapshot.position))
			saves.push({
				...entry,
				snapshot: migrateSnapshot(entry.snapshot, assets),
			})
		else archived.push(entry)
	}
	const { mainline } = progress
	return structuredClone({
		progress: {
			mainline:
				mainline && !matches(mainline)
					? (positions.find(
							({ chapterId }) => chapterId === mainline.chapterId,
						) ??
						positions[0] ??
						null)
					: mainline,
			read: progress.read.filter(matches),
			saves,
		},
		legacySaves: archived.length
			? [...legacySaves, { version: fromVersion, saves: archived }]
			: legacySaves,
	})
}
