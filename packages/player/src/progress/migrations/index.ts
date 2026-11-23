import type {
	ProgressMigrationInput,
	ProgressMigrationResult,
	SaveEntry,
	SentenceRef,
	StageSnapshot,
} from '../../contract'
import { emptyStage } from '../../stage/state'

const positionKey = ({ chapterId, sceneId, sentenceId }: SentenceRef) =>
	JSON.stringify([chapterId, sceneId, sentenceId])

function withSnapshotDefaults(snapshot: StageSnapshot): StageSnapshot {
	const defaults = emptyStage()
	const stage = snapshot.stage
	return {
		...snapshot,
		active: snapshot.active ?? [],
		stage: {
			...defaults,
			...stage,
			background: stage?.background
				? {
						...stage.background,
						transition: stage.background.transition ?? null,
					}
				: defaults.background,
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

export function migrateProgress({
	fromVersion,
	toVersion,
	positions,
	progress,
	legacySaves,
}: ProgressMigrationInput): ProgressMigrationResult {
	if (toVersion <= fromVersion)
		return structuredClone({ progress, legacySaves })

	const valid = new Set(positions.map(positionKey))
	const matches = (position: SentenceRef) => valid.has(positionKey(position))
	const saves: SaveEntry[] = []
	const archived: SaveEntry[] = []
	for (const entry of progress.saves) {
		if (matches(entry.snapshot.position))
			saves.push({ ...entry, snapshot: withSnapshotDefaults(entry.snapshot) })
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
