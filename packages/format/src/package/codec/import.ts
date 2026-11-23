import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { type Entry, openPromise, validateFileName, type ZipFile } from 'yauzl'
import type { Chapter, Series, Volume, Work } from '../../model'
import { projectFiles } from '../../model'
import {
	type PackageJson,
	packageFormatVersion,
	packageMimetype,
} from '../contract'
import { migratePackageJson, versionedDocument } from '../migrations'
import {
	checkPackageDocument,
	isWorkDocument,
	maxJsonBytes,
	parseJson,
} from './documents'
import { corrupt, PackageCodecError } from './error'
import type { PackageWork } from './export'
import { PackagePaths } from './paths'

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

async function indexEntries(zip: ZipFile) {
	const paths = new PackagePaths()
	const entries = new Map<string, Entry>()
	for await (const entry of zip.eachEntry()) {
		const path = utf8.decode(entry.fileNameRaw)
		const invalid = validateFileName(path)
		if (invalid) throw corrupt(path, invalid)
		const { compression } = paths.add(path)
		if (
			!entry.canDecodeFileData() ||
			entry.compressionMethod !== (compression === 'store' ? 0 : 8)
		)
			throw corrupt(path, 'unsupported ZIP entry compression or encryption')
		const unixType = (entry.externalFileAttributes >>> 28) & 0xf
		if (entry.versionMadeBy >>> 8 === 3 && unixType && unixType !== 8)
			throw corrupt(path, 'expected a regular ZIP file entry')
		entries.set(path, entry)
	}
	const marker = entries.get(packageMimetype.path)
	if (
		entries.keys().next().value !== packageMimetype.path ||
		!marker ||
		marker.relativeOffsetOfLocalHeader !== 0 ||
		marker.uncompressedSize !== packageMimetype.content.length ||
		!(
			await buffer(await streamEntry(zip, packageMimetype.path, marker))
		).equals(Buffer.from(packageMimetype.content))
	)
		throw corrupt(packageMimetype.path, 'invalid ZIP media type marker')
	return entries
}

async function streamEntry(zip: ZipFile, path: string, entry: Entry) {
	try {
		const header = await zip.readLocalFileHeaderPromise(entry)
		if (
			!header.fileName.equals(entry.fileNameRaw) ||
			header.compressionMethod !== entry.compressionMethod ||
			header.generalPurposeBitFlag !== entry.generalPurposeBitFlag
		)
			throw corrupt(path, 'local ZIP header differs from the directory')
		const stream = await zip.openReadStreamPromise(entry)
		return Readable.from(
			(async function* () {
				let checksum = 0
				try {
					for await (const chunk of stream) {
						checksum = crc32(chunk, checksum)
						yield chunk
					}
					if (checksum !== entry.crc32) throw new Error('ZIP checksum mismatch')
				} catch (cause) {
					throw corrupt(path, 'damaged ZIP entry', cause)
				}
			})(),
			{ objectMode: false },
		).once('close', () => stream.destroy())
	} catch (cause) {
		if (cause instanceof PackageCodecError) throw cause
		throw corrupt(path, 'could not read ZIP entry', cause)
	}
}

async function readJson(
	zip: ZipFile,
	path: string,
	entry: Entry,
	format?: number,
) {
	if (entry.uncompressedSize > maxJsonBytes)
		throw corrupt(path, 'JSON document too large')
	const raw = await buffer(await streamEntry(zip, path, entry))
	const input = versionedDocument(
		path,
		parseJson(path, raw),
		isWorkDocument(path),
	)
	if (format !== undefined && input.formatVersion !== format)
		throw corrupt(path, 'inconsistent document format versions')
	const document = migratePackageJson(path, input)
	checkPackageDocument(path, document)
	return { document, format: input.formatVersion }
}

function validateHierarchy(
	series: Series,
	entries: ReadonlyMap<string, Entry>,
	manifests: ReadonlyMap<string, PackageJson>,
): PackageWork[] {
	const expected = new Set<string>()
	const workIds = new Set<string>()
	const works: PackageWork[] = []
	function requireManifest<T>(path: string): T {
		const document = manifests.get(path)
		if (!document) throw corrupt(path, 'missing manifest')
		expected.add(path)
		return document as T
	}
	const volumes = new Set(series.volumeIds)
	const workPaths = new Set<string>()
	for (const volumeId of volumes) {
		const volumePath = projectFiles.volume(volumeId).path
		const volume = requireManifest<Volume>(volumePath)
		if (volume.volumeId !== volumeId)
			throw corrupt(volumePath, 'volume ID mismatch')
		for (const workId of volume.workIds) {
			const workPath = projectFiles.work(volumeId, workId).path
			const work = requireManifest<Work>(workPath)
			if (work.workId !== workId || workIds.has(workId))
				throw corrupt(workPath, 'mismatched or duplicate work ID')
			if (!Number.isSafeInteger(work.version) || work.version < 1)
				throw corrupt(workPath, 'invalid released work version')
			workIds.add(workId)
			workPaths.add(posix.dirname(workPath))
			works.push({ volumeId, work })
			for (const chapterId of work.chapterIds) {
				const ref = { volumeId, workId, chapterId }
				const chapterPath = projectFiles.chapter(ref).path
				const chapter = requireManifest<Chapter>(chapterPath)
				if (chapter.chapterId !== chapterId)
					throw corrupt(chapterPath, 'chapter ID mismatch')
				for (const sceneId of chapter.sceneIds) {
					const path = projectFiles.scene(ref, sceneId)
					if (!entries.has(path)) throw corrupt(path, 'missing scene')
					expected.add(path)
				}
			}
		}
	}
	if (!works.length) throw corrupt('series.json', 'package contains no works')
	for (const path of entries.keys()) {
		const [root, volumeId, folder, workId, leaf] = path.split('/')
		if (
			root === 'volumes' &&
			(!volumes.has(volumeId) ||
				(folder === 'works' &&
					!workPaths.has(`volumes/${volumeId}/works/${workId}`)) ||
				((leaf === 'chapters' ||
					folder === 'volume.json' ||
					leaf === 'work.json') &&
					!expected.has(path)))
		)
			throw corrupt(path, 'entry is not listed by its parent manifest')
	}
	return works
}

export class WorkPackage {
	private constructor(
		private readonly zip: ZipFile,
		private readonly index: ReadonlyMap<string, Entry>,
		private readonly format: number,
		readonly series: Series,
		readonly works: readonly PackageWork[],
	) {}

	static async open(path: string): Promise<WorkPackage> {
		let zip: ZipFile | undefined
		try {
			zip = await openPromise(path, {
				autoClose: false,
				lazyEntries: true,
				decodeStrings: false,
				validateEntrySizes: true,
			})
			const entries = await indexEntries(zip)
			const seriesPath = projectFiles.series.path
			const seriesEntry = entries.get(seriesPath)
			if (!seriesEntry) throw corrupt(seriesPath, 'missing series manifest')
			const { document: seriesDoc, format } = await readJson(
				zip,
				seriesPath,
				seriesEntry,
			)
			const manifests = new Map<string, PackageJson>()
			for (const [name, entry] of entries) {
				if (name === seriesPath || !name.endsWith('.json')) continue
				const { document } = await readJson(zip, name, entry, format)
				if (
					/^volumes\/[^/]+\/(?:volume\.json|works\/[^/]+\/(?:work\.json|chapters\/[^/]+\/chapter\.json))$/.test(
						name,
					)
				)
					manifests.set(name, document)
			}
			const series = seriesDoc as Series
			const works = validateHierarchy(series, entries, manifests)
			return new WorkPackage(zip, entries, format, series, works)
		} catch (cause) {
			zip?.close()
			if (cause instanceof PackageCodecError) throw cause
			throw corrupt(path, 'could not open work package', cause)
		}
	}

	entries(): IterableIterator<string> {
		return this.index.keys()
	}

	async openEntry(path: string): Promise<Readable> {
		const entry = this.index.get(path)
		if (!entry) throw corrupt(path, 'entry not found')
		if (this.format !== packageFormatVersion && path.endsWith('.json')) {
			const { document } = await readJson(this.zip, path, entry, this.format)
			return Readable.from(
				Buffer.from(`${JSON.stringify(document, null, '\t')}\n`),
			)
		}
		return streamEntry(this.zip, path, entry)
	}

	async extractTo(destination: string): Promise<void> {
		let created = false
		try {
			await mkdir(destination, { mode: 0o700 })
			created = true
			for (const path of this.entries()) {
				if (path === packageMimetype.path) continue
				const output = join(destination, ...path.split('/'))
				await mkdir(dirname(output), { recursive: true })
				await pipeline(
					await this.openEntry(path),
					createWriteStream(output, { flags: 'wx' }),
				)
			}
		} catch (cause) {
			if (created) await rm(destination, { recursive: true, force: true })
			if (cause instanceof PackageCodecError) throw cause
			throw new PackageCodecError(
				'write_failed',
				'Could not extract work package',
				{ cause },
			)
		}
	}

	close(): void {
		this.zip.close()
	}

	[Symbol.dispose](): void {
		this.close()
	}
}

export const openPackage = WorkPackage.open
