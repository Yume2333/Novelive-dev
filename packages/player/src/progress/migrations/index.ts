import type {
	PlaybackBeat,
	ProgressMigrationInput,
	ProgressMigrationResult,
	SaveEntry,
	SentenceRef,
	StageSnapshot,
} from '../../contract'
import { direct, emptyStage } from '../../stage/state'
import { captureSnapshot, sentenceKey } from '..'

function rebuildSnapshots(
	chapters: readonly (readonly PlaybackBeat[])[],
	wanted: ReadonlySet<string>,
): Map<string, StageSnapshot> {
	const snapshots = new Map<string, StageSnapshot>()
	for (const chapter of chapters) {
		const lastSave = chapter.findLastIndex(
			({ cue }) => cue.kind === 'text' && wanted.has(sentenceKey(cue.position)),
		)
		let stage = emptyStage()
		for (const { actions, cue } of chapter.slice(0, lastSave + 1)) {
			stage = actions.reduce(direct, stage)
			if (cue.kind === 'text') {
				const key = sentenceKey(cue.position)
				if (wanted.has(key))
					snapshots.set(
						key,
						captureSnapshot(cue.position, { ...stage, text: cue.text }, [
							{ restore: 'restart-text' },
						]),
					)
			}
		}
	}
	return snapshots
}

export function migrateProgress(
	{
		fromVersion,
		toVersion,
		positions,
		progress,
		legacySaves,
	}: ProgressMigrationInput,
	chapters: readonly (readonly PlaybackBeat[])[],
): ProgressMigrationResult {
	if (toVersion <= fromVersion)
		return structuredClone({ progress, legacySaves })

	const valid = new Set(positions.map(sentenceKey))
	const matches = (position: SentenceRef) => valid.has(sentenceKey(position))
	const snapshots = rebuildSnapshots(
		chapters,
		new Set(
			progress.saves.map(({ snapshot }) => sentenceKey(snapshot.position)),
		),
	)
	const saves: SaveEntry[] = []
	const archived: SaveEntry[] = []
	for (const entry of progress.saves) {
		const snapshot = snapshots.get(sentenceKey(entry.snapshot.position))
		if (snapshot) saves.push({ ...entry, snapshot })
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
