import { createHash, randomUUID } from 'node:crypto'
import {
	access,
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import {
	type ProgressStore,
	type SaveEntry,
	type SaveSlot,
	type StageSnapshot,
	saveThumbnail,
	type WorkProgress,
} from '../../../../packages/player/src/contract'
import { slotKey } from '../../../../packages/player/src/progress'

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
		return this.read(workId)
	}

	private async read(workId: string): Promise<WorkProgress | null> {
		try {
			return JSON.parse(
				await readFile(join(this.directory(workId), 'progress.json'), 'utf8'),
			) as WorkProgress
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
			throw error
		}
	}

	private async write(workId: string, progress: WorkProgress): Promise<void> {
		const slots = progress.saves.map((entry) => slotKey(entry.slot))
		if (new Set(slots).size !== slots.length) throw new Error('存档槽位重复')
		const directory = this.directory(workId)
		await mkdir(directory, { recursive: true })
		const temporary = join(directory, `${randomUUID()}.tmp`)
		await writeFile(temporary, JSON.stringify(progress), 'utf8')
		await rename(temporary, join(directory, 'progress.json'))
	}

	save(workId: string, progress: WorkProgress): Promise<void> {
		const copy = structuredClone(progress)
		return this.enqueue(() => this.write(workId, copy))
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
			const progress = (await this.read(workId)) ?? {
				mainline: null,
				read: [],
				saves: [],
			}
			progress.saves = [
				...progress.saves.filter((save) => slotKey(save.slot) !== name),
				entry,
			]
			await this.write(workId, progress)
			const referenced = new Set(
				progress.saves.map((save) => save.thumbnailRef),
			)
			for (const file of await readdir(this.directory(workId))) {
				if (file.endsWith('.webp') && !referenced.has(file))
					await unlink(join(this.directory(workId), file))
			}
			return entry
		})
	}

	async thumbnail(workId: string, entry: SaveEntry): Promise<Buffer> {
		if (!/^[a-f0-9]{64}\.webp$/.test(entry.thumbnailRef))
			throw new Error('无效的缩略图引用')
		return readFile(join(this.directory(workId), entry.thumbnailRef))
	}
}

export async function createDesktopProgressStore(): Promise<FileProgressStore> {
	const { app } = await import('electron')
	await app.whenReady()
	return new FileProgressStore(app.getPath('userData'))
}
