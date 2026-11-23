import { createHash, randomUUID } from 'node:crypto'
import {
	access,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import {
	type LegacySaveGroup,
	type PlaybackBeat,
	type ProgressMigrationInput,
	type ProgressMigrationResult,
	type ProgressStore,
	type SaveEntry,
	type SaveSlot,
	type StageSnapshot,
	saveThumbnail,
	type WorkProgress,
} from '../../../../packages/player/src/contract'
import { slotKey } from '../../../../packages/player/src/progress'
import { migrateProgress } from '../../../../packages/player/src/progress/migrations'

type ProgressFile = WorkProgress & { legacySaves?: readonly LegacySaveGroup[] }
type StoredMigration = Omit<
	ProgressMigrationInput,
	'positions' | 'progress' | 'legacySaves'
> & {
	chapters: readonly (readonly PlaybackBeat[])[]
}
type MigrationBackup = Pick<
	StoredMigration,
	'workId' | 'fromVersion' | 'toVersion'
> & {
	stored: ProgressMigrationResult
}

function migratedProgress(
	{ chapters, ...update }: StoredMigration,
	stored: ProgressMigrationResult,
) {
	const positions = chapters.flatMap((chapter) =>
		chapter.flatMap(({ cue }) => (cue.kind === 'text' ? [cue.position] : [])),
	)
	return migrateProgress({ ...update, ...stored, positions }, chapters)
}

export class FileProgressStore implements ProgressStore {
	private pending: Promise<unknown> = Promise.resolve()

	constructor(private readonly userData: string) {}

	private directory(workId: string): string {
		return join(
			this.userData,
			'player-progress',
			createHash('sha256').update(workId).digest('hex'),
		)
	}

	private enqueue<T>(run: () => Promise<T>): Promise<T> {
		const result = this.pending.then(run)
		this.pending = result.catch(() => {})
		return result
	}

	async load(workId: string): Promise<WorkProgress | null> {
		await this.pending
		return (await this.read(workId))?.progress ?? null
	}

	private async read(workId: string): Promise<ProgressMigrationResult | null> {
		try {
			const { legacySaves = [], ...progress } = JSON.parse(
				await readFile(join(this.directory(workId), 'progress.json'), 'utf8'),
			) as ProgressFile
			return { progress, legacySaves }
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
			throw error
		}
	}

	private async write(
		workId: string,
		{ progress, legacySaves }: ProgressMigrationResult,
	): Promise<void> {
		const slots = progress.saves.map((entry) => slotKey(entry.slot))
		if (new Set(slots).size !== slots.length) throw new Error('存档槽位重复')
		const directory = this.directory(workId)
		await mkdir(directory, { recursive: true })
		const temporary = join(directory, `${randomUUID()}.tmp`)
		const file = legacySaves.length ? { ...progress, legacySaves } : progress
		await writeFile(temporary, JSON.stringify(file), 'utf8')
		await rename(temporary, join(directory, 'progress.json'))
	}

	private get migrationJournal() {
		return join(this.userData, 'player-progress', 'pending-package-update.json')
	}

	private async restoreMigration(backups: readonly MigrationBackup[]) {
		for (const { workId, stored } of backups) await this.write(workId, stored)
	}

	recoverPackageMigration(
		hasVersion: (workId: string, version: number) => boolean,
	) {
		return this.enqueue(async () => {
			let backups: MigrationBackup[]
			try {
				backups = JSON.parse(await readFile(this.migrationJournal, 'utf8'))
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
				throw error
			}
			if (
				!backups.every(({ workId, toVersion }) => hasVersion(workId, toVersion))
			) {
				if (
					!backups.every(({ workId, fromVersion }) =>
						hasVersion(workId, fromVersion),
					)
				)
					throw new Error(
						'Package migration journal does not match the installed library',
					)
				await this.restoreMigration(backups)
			}
			await rm(this.migrationJournal)
		})
	}

	save(workId: string, progress: WorkProgress): Promise<void> {
		const copy = structuredClone(progress)
		return this.enqueue(async () => {
			const stored = await this.read(workId)
			await this.write(workId, {
				progress: copy,
				legacySaves: stored?.legacySaves ?? [],
			})
		})
	}

	migrate(input: StoredMigration): Promise<ProgressMigrationResult> {
		const update = structuredClone(input)
		return this.enqueue(async () => {
			const stored = await this.read(update.workId)
			if (!stored)
				return {
					progress: { mainline: null, read: [], saves: [] },
					legacySaves: [],
				}
			const migrated = migratedProgress(update, stored)
			await this.write(update.workId, migrated)
			return migrated
		})
	}

	migrateAndPublish(
		inputs: readonly StoredMigration[],
		publish: () => Promise<void>,
	) {
		const updates = structuredClone(inputs)
		return this.enqueue(async () => {
			const backups: MigrationBackup[] = []
			const migrated: Array<[string, ProgressMigrationResult]> = []
			for (const update of updates) {
				const { workId, fromVersion, toVersion } = update
				const stored = await this.read(workId)
				if (!stored) continue
				backups.push({ workId, fromVersion, toVersion, stored })
				migrated.push([workId, migratedProgress(update, stored)])
			}
			if (!backups.length) return publish()
			const journal = this.migrationJournal
			const temporary = `${journal}.tmp`
			try {
				await access(journal)
				throw new Error('A previous package migration requires recovery')
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
			}
			await writeFile(temporary, JSON.stringify(backups), 'utf8')
			await rename(temporary, journal)
			try {
				for (const [workId, stored] of migrated)
					await this.write(workId, stored)
				await publish()
			} catch (error) {
				try {
					await this.restoreMigration(backups)
					await rm(journal)
				} catch (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						'Save migration rollback failed',
					)
				}
				throw error
			}
			await rm(journal, { force: true })
		})
	}

	async loadLegacySaves(workId: string): Promise<readonly LegacySaveGroup[]> {
		await this.pending
		return (await this.read(workId))?.legacySaves ?? []
	}

	deleteLegacySave(
		workId: string,
		version: number,
		slot: SaveSlot,
	): Promise<void> {
		const name = slotKey(slot)
		return this.enqueue(async () => {
			const stored = await this.read(workId)
			if (!stored) return
			const legacySaves = stored.legacySaves
				.map((group) =>
					group.version === version
						? {
								...group,
								saves: group.saves.filter(
									(entry) => slotKey(entry.slot) !== name,
								),
							}
						: group,
				)
				.filter((group) => group.saves.length > 0)
			const remaining = { ...stored, legacySaves }
			await this.write(workId, remaining)
			await this.cleanThumbnails(workId, remaining)
		})
	}

	private async cleanThumbnails(
		workId: string,
		{ progress, legacySaves }: ProgressMigrationResult,
	): Promise<void> {
		const referenced = new Set(progress.saves.map((save) => save.thumbnailRef))
		for (const group of legacySaves)
			for (const save of group.saves) referenced.add(save.thumbnailRef)
		const directory = this.directory(workId)
		const files = await readdir(directory).catch(() => [])
		for (const file of files) {
			if (file.endsWith('.webp') && !referenced.has(file))
				await unlink(join(directory, file)).catch(() => {})
		}
	}

	saveSlot(
		workId: string,
		slot: SaveSlot,
		snapshot: StageSnapshot,
		stageCapture: Uint8Array,
	): Promise<SaveEntry> {
		const name = slotKey(slot)
		const captured = structuredClone({ slot, snapshot, stageCapture })
		return this.enqueue(async () => {
			const image = await sharp(captured.stageCapture)
				.resize(saveThumbnail.width, saveThumbnail.height, { fit: 'cover' })
				.webp()
				.toBuffer()
			const thumbnailRef = `${createHash('sha256').update(image).digest('hex')}.webp`
			await mkdir(this.directory(workId), { recursive: true })
			const thumbnailPath = join(this.directory(workId), thumbnailRef)
			try {
				await access(thumbnailPath)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
				const temporary = join(this.directory(workId), `${randomUUID()}.tmp`)
				await writeFile(temporary, image, { flag: 'wx' })
				await rename(temporary, thumbnailPath)
			}
			const entry: SaveEntry = {
				slot: captured.slot,
				snapshot: captured.snapshot,
				savedAt: new Date().toISOString(),
				thumbnailRef,
			}
			const stored = (await this.read(workId)) ?? {
				progress: { mainline: null, read: [], saves: [] },
				legacySaves: [],
			}
			stored.progress.saves = [
				...stored.progress.saves.filter((save) => slotKey(save.slot) !== name),
				entry,
			]
			await this.write(workId, stored)
			await this.cleanThumbnails(workId, stored)
			return entry
		})
	}

	async thumbnail(workId: string, entry: SaveEntry): Promise<Buffer> {
		if (!/^[a-f0-9]{64}\.webp$/.test(entry.thumbnailRef))
			throw new Error('无效的缩略图引用')
		return readFile(join(this.directory(workId), entry.thumbnailRef))
	}
}

let desktopProgressStore: FileProgressStore | undefined

export async function createDesktopProgressStore(): Promise<FileProgressStore> {
	const { app } = await import('electron')
	await app.whenReady()
	desktopProgressStore ??= new FileProgressStore(app.getPath('userData'))
	return desktopProgressStore
}
