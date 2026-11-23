import { randomUUID } from 'node:crypto'
import {
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { packageUpdate } from '@novelive/format/package'
import { openPackage, PackageCodecError } from '@novelive/format/package/codec'
import { compileScript } from '@novelive/format/script'
import { toPlaybackBeats } from '../../../player/src/contract/playback'
import type { ShareRequest } from '../contract/share'
import { loadPlayerChapter, loadPlayerStatus } from '../project/player'
import { optionalFile } from '../project/series/resolve'
import { initializeExtractedProject } from './project'

type InstalledWork = {
	workId: string
	version: number
	title: string
	installation: string
	chapters: number
	published: number
}

type Updates = Extract<ShareRequest, { operation: 'import' }>['approvedUpdates']
type Migration = Updates[number] & {
	chapters: ReturnType<typeof toPlaybackBeats>[]
}

export class InstalledPackages {
	private readonly directory: string
	private readonly index: string

	private constructor(
		private readonly dataDir: string,
		private readonly archiveDir: string,
		private works: InstalledWork[],
	) {
		this.directory = join(dataDir, 'installed-works')
		this.index = join(this.directory, 'library.json')
	}

	static async open(dataDir: string, documents: string) {
		const saved = await optionalFile(() =>
			readFile(join(dataDir, 'installed-works', 'library.json'), 'utf8'),
		)
		return new InstalledPackages(
			dataDir,
			join(documents, 'Novelive', '导入的作品'),
			saved ? JSON.parse(saved) : [],
		)
	}

	list() {
		return this.works.map(({ installation: _, ...work }) => work)
	}

	private inspect(archive: Awaited<ReturnType<typeof openPackage>>) {
		return archive.works.map(({ work: { workId, version, title } }) => {
			const work = { workId, version }
			const installed = this.works.find((entry) => entry.workId === workId)
			return installed
				? {
						relation: packageUpdate(work, installed) as Exclude<
							ReturnType<typeof packageUpdate>,
							'new'
						>,
						work,
						title,
						installedVersion: installed.version,
					}
				: { relation: 'new' as const, work, title }
		})
	}

	async inspectPath(path: string) {
		using archive = await openPackage(path)
		return this.inspect(archive)
	}

	hasVersion(workId: string, version: number) {
		return this.works.some(
			(work) => work.workId === workId && work.version === version,
		)
	}

	async chapter(workId: string, version: number, chapterId?: string) {
		const work = this.works.find(
			(work) => work.workId === workId && work.version === version,
		)
		if (!work) throw new Error('未找到此版本的作品')
		const root = join(this.directory, work.installation)
		const first =
			chapterId ??
			(await loadPlayerStatus(root, workId)).chapters.find(
				(chapter) => chapter.published,
			)?.chapterId
		return {
			...(await loadPlayerChapter(
				root,
				workId,
				join(this.dataDir, 'cache'),
				first,
			)),
			linked: false,
		}
	}

	async install(
		packagePath: string,
		approved: Updates,
		withStoppedWrites: (
			migrations: Migration[],
			publish: () => Promise<void>,
		) => Promise<void>,
		trash: (path: string) => Promise<void>,
	) {
		const installation = randomUUID()
		const archivePath = join(this.archiveDir, `${installation}.novelive`)
		const root = join(this.directory, installation)
		const stagedIndex = join(this.directory, `${installation}.json`)
		let committed = false
		let replaced: Set<string>
		let added: InstalledWork[]
		await mkdir(this.archiveDir, { recursive: true })
		await mkdir(this.directory, { recursive: true })
		try {
			await copyFile(packagePath, archivePath)
			using archive = await openPackage(archivePath)
			const inspection = this.inspect(archive)
			const updates = inspection.flatMap((entry) =>
				entry.relation === 'update'
					? [
							{
								workId: entry.work.workId,
								installedVersion: entry.installedVersion,
								incomingVersion: entry.work.version,
							},
						]
					: [],
			)
			if (
				updates.length !== approved.length ||
				updates.some(
					(update) =>
						!approved.some(
							(entry) =>
								entry.workId === update.workId &&
								entry.installedVersion === update.installedVersion &&
								entry.incomingVersion === update.incomingVersion,
						),
				)
			)
				throw new PackageCodecError(
					'invalid_selection',
					'The approved versions no longer match',
				)
			const selected = inspection.filter(
				(entry) => entry.relation === 'new' || entry.relation === 'update',
			)
			if (!selected.length) return []
			await archive.extractTo(root)
			initializeExtractedProject(root)
			const cache = join(this.dataDir, 'cache')
			const migrations: Migration[] = []
			added = []
			for (const entry of selected) {
				const { workId, version } = entry.work
				const { chapters } = await loadPlayerStatus(root, workId)
				const published = chapters.filter((chapter) => chapter.published)
				added.push({
					workId,
					title: entry.title,
					version,
					installation,
					chapters: chapters.length,
					published: published.length,
				})
				const update = updates.find((update) => update.workId === workId)
				if (!update) continue
				const beats = []
				for (const { chapterId } of published) {
					const content = await loadPlayerChapter(
						root,
						workId,
						cache,
						chapterId,
					)
					const {
						chapter,
						registry,
						speakers,
						speakerNames,
						customMarks,
						script,
					} = content
					let nextId = 0
					const result = compileScript(script, {
						makeId: (bytes) => (++nextId).toString(16).padStart(bytes * 2, '0'),
						paragraphIds: chapter.paragraphIds,
						sceneIds: chapter.sceneIds,
						assets: registry.entries,
						speakers,
						customMarks: Object.keys(customMarks),
					})
					if (!result.ok)
						throw new PackageCodecError(
							'corrupt_package',
							'Could not compile the incoming chapter',
						)
					beats.push(toPlaybackBeats(chapterId, result.scenes, speakerNames))
				}
				migrations.push({ ...update, chapters: beats })
			}
			const affected = new Set(added.map(({ workId }) => workId))
			const next = [
				...this.works.filter(({ workId }) => !affected.has(workId)),
				...added,
			]
			const retained = new Set(next.map(({ installation }) => installation))
			replaced = new Set(
				this.works
					.map(({ installation }) => installation)
					.filter((id) => !retained.has(id)),
			)
			await writeFile(stagedIndex, JSON.stringify(next), { flag: 'wx' })
			await withStoppedWrites(migrations, async () => {
				await rename(stagedIndex, this.index)
				this.works = next
				committed = true
			})
		} finally {
			if (!committed)
				await Promise.all([
					rm(root, { recursive: true, force: true }),
					rm(archivePath, { force: true }),
					rm(stagedIndex, { force: true }),
				])
		}
		for (const id of replaced) {
			await trash(join(this.archiveDir, `${id}.novelive`))
			await rm(join(this.directory, id), { recursive: true, force: true })
		}
		return added.map(({ workId, version }) => ({ workId, version }))
	}
}
