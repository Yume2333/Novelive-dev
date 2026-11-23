import { addAbortListener } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { type PassThrough, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import {
	type ProjectDocument,
	type ProjectScope,
	projectFiles,
	type Work,
} from '../../model'
import {
	includePackageEntry,
	nextExportVersion,
	packageMimetype,
} from '../contract'
import { versionedDocument } from '../migrations'
import {
	checkPackageDocument,
	isWorkDocument,
	maxJsonBytes,
	parseJson,
	validateDocument,
} from './documents'
import { corrupt, PackageCodecError } from './error'
import { PackagePaths } from './paths'

export type PackageWork = { volumeId: string; work: Work }

export type PackageExportOptions = {
	projectRoot: string
	destination: string
	scope: ProjectScope
	includeSource?: boolean
}

type ExportEntry = { path: string; data?: Buffer }

async function projectFile(root: string, path: string) {
	const parts = path.split('/')
	let absolute = root
	for (const [index, part] of parts.entries()) {
		absolute = join(absolute, part)
		const stat = await lstat(absolute)
		if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
			throw corrupt(path, 'expected a regular project file')
	}
	return absolute
}

async function readProjectJson(root: string, path: string) {
	const absolute = await projectFile(root, path)
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of createReadStream(absolute)) {
		size += chunk.length
		if (size > maxJsonBytes) throw corrupt(path, 'JSON document too large')
		chunks.push(chunk)
	}
	return versionedDocument(
		path,
		parseJson(path, Buffer.concat(chunks, size)),
		isWorkDocument(path),
	)
}

async function readProjectDocument<T>(root: string, file: ProjectDocument<T>) {
	return validateDocument(
		file.path,
		file.schema,
		await readProjectJson(root, file.path),
	)
}

async function* optionalEntries(
	root: string,
	relative: string,
	includeSource: boolean,
): AsyncGenerator<ExportEntry> {
	let stat: Awaited<ReturnType<typeof lstat>>
	try {
		stat = await lstat(join(root, relative))
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
			return
		throw error
	}
	if (stat.isDirectory()) {
		const children = await readdir(join(root, relative))
		for (const child of children.sort())
			yield* optionalEntries(root, `${relative}/${child}`, includeSource)
	} else if (stat.isFile() && includePackageEntry(relative, includeSource)) {
		yield { path: relative }
	}
}

async function* sharedEntries(root: string, directory: string) {
	for (const file of ['bible', 'glossary.json', 'styles.css', 'assets'])
		yield* optionalEntries(root, posix.join(directory, file), false)
}

function jsonEntry(path: string, data: object): ExportEntry {
	return { path, data: Buffer.from(`${JSON.stringify(data, null, '\t')}\n`) }
}

async function* selectedEntries(
	{ projectRoot: root, scope, includeSource }: PackageExportOptions,
	works: PackageWork[],
): AsyncGenerator<ExportEntry> {
	const series = await readProjectDocument(root, projectFiles.series)
	const volumeIds =
		scope.level === 'series' ? series.volumeIds : [scope.volumeId]
	if (scope.level !== 'series' && !series.volumeIds.includes(scope.volumeId))
		throw new PackageCodecError(
			'invalid_selection',
			'Volume is not in the series',
		)

	yield jsonEntry(projectFiles.series.path, { ...series, volumeIds })
	yield* sharedEntries(root, '')
	const knownWorkIds = new Set<string>()
	for (const volumeId of volumeIds) {
		const file = projectFiles.volume(volumeId)
		const volume = await readProjectDocument(root, file)
		if (volume.volumeId !== volumeId)
			throw corrupt(file.path, 'volume ID mismatch')
		const workIds = scope.level === 'work' ? [scope.workId] : volume.workIds
		if (scope.level === 'work' && !volume.workIds.includes(scope.workId))
			throw new PackageCodecError(
				'invalid_selection',
				'Work is not in the volume',
			)
		yield jsonEntry(file.path, { ...volume, workIds })
		yield* sharedEntries(root, posix.dirname(file.path))

		for (const workId of workIds) {
			const file = projectFiles.work(volumeId, workId)
			const work = await readProjectDocument(root, file)
			if (work.workId !== workId || knownWorkIds.has(workId))
				throw corrupt(file.path, 'mismatched or duplicate work ID')
			knownWorkIds.add(workId)
			const released = { ...work, version: nextExportVersion(work.version) }
			works.push({ volumeId, work: released })
			yield jsonEntry(file.path, released)
			yield* sharedEntries(root, posix.dirname(file.path))

			for (const chapterId of released.chapterIds) {
				const ref = { volumeId, workId, chapterId }
				const file = projectFiles.chapter(ref)
				const chapter = await readProjectDocument(root, file)
				if (chapter.chapterId !== chapterId)
					throw corrupt(file.path, 'chapter ID mismatch')
				yield jsonEntry(file.path, chapter)
				for (const sceneId of chapter.sceneIds)
					yield { path: projectFiles.scene(ref, sceneId) }
			}
		}
	}
	if (!works.length)
		throw new PackageCodecError(
			'invalid_selection',
			'Selection contains no works',
		)
	if (includeSource) yield* optionalEntries(root, 'source', true)
}

export async function exportPackage(
	options: PackageExportOptions,
): Promise<readonly PackageWork[]> {
	const works: PackageWork[] = []
	const paths = new PackagePaths()
	const zip = new ZipFile()
	const output = zip.outputStream as PassThrough
	const stop = new AbortController()
	zip.on('error', (error) => output.destroy(error))
	let stage: string | undefined
	try {
		stage = await mkdtemp(
			join(dirname(options.destination), '.novelive-export-'),
		)
		const temporary = join(stage, 'package')
		const written = pipeline(output, createWriteStream(temporary))
		// Observe output failures while the selection is still being enumerated.
		void written.catch((error) => stop.abort(error))
		zip.addBuffer(Buffer.from(packageMimetype.content), packageMimetype.path, {
			compress: false,
		})
		try {
			for await (const { path, data } of selectedEntries(options, works)) {
				stop.signal.throwIfAborted()
				const { compression } = paths.add(path)
				const compress = compression === 'deflate'
				if (data && data.length > maxJsonBytes)
					throw corrupt(path, 'JSON document too large')
				const source = { signal: stop.signal }
				let read: () => Readable
				if (data) {
					read = () => Readable.from(data, source)
				} else {
					const absolute = await projectFile(options.projectRoot, path)
					if (path.endsWith('.json'))
						checkPackageDocument(
							path,
							await readProjectJson(options.projectRoot, path),
						)
					read = () => createReadStream(absolute, source)
				}
				// Wait for yazl to start this entry before staging the next one.
				const { promise, resolve, reject } = Promise.withResolvers<void>()
				using _abort = addAbortListener(stop.signal, () =>
					reject(stop.signal.reason),
				)
				zip.addReadStreamLazy(
					path,
					{ compress, size: data?.length },
					(open) => {
						const stream = read()
						stream.on('error', (error) => output.destroy(error))
						open(null, stream)
						resolve()
					},
				)
				await promise
			}
			zip.end()
			await written
		} catch (error) {
			stop.abort(error)
			output.destroy()
			await written.catch(() => {})
			throw error
		}
		await rename(temporary, options.destination)
		return works
	} catch (cause) {
		if (cause instanceof PackageCodecError) throw cause
		throw new PackageCodecError(
			'write_failed',
			'Could not export work package',
			{
				cause,
			},
		)
	} finally {
		if (stage) await rm(stage, { recursive: true, force: true })
	}
}
