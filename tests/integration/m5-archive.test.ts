import { createWriteStream } from 'node:fs'
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { pipeline } from 'node:stream/promises'
import { projectFiles } from '@novelive/format/model'
import { packageMimetype } from '@novelive/format/package'
import { exportPackage, openPackage } from '@novelive/format/package/codec'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Entry, openPromise } from 'yauzl'
import { ZipFile } from 'yazl'
import { migratePackageJson } from '../../packages/format/src/package/migrations'
import {
	artPath,
	chapterPath,
	projectEntries,
	scenePath,
	scope,
	series,
	work,
	workA,
	workB,
	workC,
	workPath,
	writeProject,
} from '../fixtures/work-packages/series'

let directory: string
let projectRoot: string
let destination: string

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'novelive-archive-test-'))
	projectRoot = join(directory, 'project')
	destination = join(directory, 'book.novelive')
	await writeProject(projectRoot)
})
afterEach(() => rm(directory, { recursive: true, force: true }))

type RawEntry = [path: string, value: string, compress?: boolean, mode?: number]
const marker: RawEntry = [packageMimetype.path, packageMimetype.content, false]

function releasedEntries(): Map<string, string> {
	const entries = projectEntries()
	for (const path of entries.keys()) {
		if (path.endsWith('/work.json')) {
			const manifest = JSON.parse(entries.get(path) as string)
			entries.set(path, JSON.stringify({ ...manifest, version: 1 }))
		} else if (
			path.startsWith('source/') ||
			path.startsWith('candidates/') ||
			path === 'project.db'
		) {
			entries.delete(path)
		}
	}
	return entries
}

async function rawArchive(entries: RawEntry[]) {
	const zip = new ZipFile()
	for (const [path, value, compress = !path.endsWith('.webp'), mode] of entries)
		zip.addBuffer(Buffer.from(value), path, { compress, mode })
	const complete = pipeline(zip.outputStream, createWriteStream(destination))
	zip.end()
	await complete
}

async function invalidNameArchive(name: string) {
	// Start with a same-length placeholder so the ZIP itself stays well-formed.
	const placeholder = 'x'.repeat(name.length)
	await rawArchive([marker, ...releasedEntries(), [placeholder, 'contents']])
	const zip = await readFile(destination)
	for (let offset = zip.indexOf(placeholder); offset >= 0; ) {
		zip.write(name, offset, 'ascii')
		offset = zip.indexOf(placeholder, offset + name.length)
	}
	await writeFile(destination, zip)
}

describe('M5 .novelive archive', () => {
	it('uses the physical ZIP marker, UTF-8 filenames and locked compression', async () => {
		await exportPackage({ projectRoot, destination, scope })
		const zip = await openPromise(destination, { lazyEntries: true })
		const entries: Entry[] = []
		for await (const entry of zip.eachEntry()) entries.push(entry)
		expect(entries[0]).toMatchObject({
			fileName: 'mimetype',
			compressionMethod: 0,
			relativeOffsetOfLocalHeader: 0,
		})
		expect(entries.find((entry) => entry.fileName === artPath)).toMatchObject({
			compressionMethod: 0,
			generalPurposeBitFlag: expect.any(Number),
		})
		expect(
			entries.find((entry) => entry.fileName === artPath)
				?.generalPurposeBitFlag,
		).toSatisfy((flags: number) => (flags & 0x800) !== 0)
		for (const path of ['series.json', 'styles.css', scenePath])
			expect(
				entries.find((entry) => entry.fileName === path)?.compressionMethod,
			).toBe(8)
	})

	it.each([
		[scope, ['vol-a'], [workA]],
		[
			{ level: 'volume', volumeId: 'vol-a' } as const,
			['vol-a'],
			[workA, workB],
		],
		[{ level: 'series' } as const, ['vol-a', 'vol-b'], [workA, workB, workC]],
	] as const)(
		'round-trips %j with inherited content and excludes private files',
		async (selection, volumes, ids) => {
			const works = await exportPackage({
				projectRoot,
				destination,
				scope: selection,
			})
			using archive = await openPackage(destination)
			expect(archive.series.volumeIds).toEqual(volumes)
			expect(archive.works).toEqual(works)
			expect(works.map(({ work }) => work.workId)).toEqual(ids)
			expect(works[0].work).toMatchObject({
				version: 1,
				futureField: { preserved: true },
			})
			if (ids.some((id) => id === workB)) expect(works[1].work.version).toBe(5)
			expect(
				JSON.parse(await readFile(join(projectRoot, workPath), 'utf8')).version,
			).toBe(0)
			expect(
				Array.from(archive.entries()).some((path) =>
					/^source\/|^candidates\/|^project\.db$/.test(path),
				),
			).toBe(false)
			const extracted = join(directory, 'extracted')
			await archive.extractTo(extracted)
			expect(await readdir(extracted)).not.toContain('mimetype')
			for (const path of [
				artPath,
				scenePath,
				'styles.css',
				'volumes/vol-a/styles.css',
				projectFiles.styles(scope),
			])
				expect(await readFile(join(extracted, path))).toEqual(
					await readFile(join(projectRoot, path)),
				)
			expect(
				JSON.parse(await readFile(join(extracted, 'glossary.json'), 'utf8')),
			).toMatchObject({ future: 'keep' })
			expect(await text(await archive.openEntry('mimetype'))).toBe(
				packageMimetype.content,
			)
		},
	)

	it('includes allowed source files only when explicitly selected', async () => {
		await exportPackage({
			projectRoot,
			destination,
			scope,
			includeSource: true,
		})
		using archive = await openPackage(destination)
		expect(
			Array.from(archive.entries()).filter((path) =>
				path.startsWith('source/'),
			),
		).toEqual(['source/original.txt'])
		expect(await text(await archive.openEntry('source/original.txt'))).toBe(
			'Original text, opt-in only',
		)
	})

	it('does not overwrite an existing destination after an export error', async () => {
		await writeFile(destination, 'previous export')
		await rm(join(projectRoot, scenePath))
		await expect(
			exportPackage({ projectRoot, destination, scope }),
		).rejects.toMatchObject({ code: 'write_failed' })
		expect(await readFile(destination, 'utf8')).toBe('previous export')
		expect(await readdir(directory)).toEqual(['book.novelive', 'project'])
	})

	it.skipIf(process.platform === 'win32')(
		'does not follow project symlinks when exporting',
		async () => {
			const original = join(projectRoot, 'source/original.txt')
			await rm(original)
			await symlink(join(projectRoot, 'project.db'), original)
			await exportPackage({
				projectRoot,
				destination,
				scope,
				includeSource: true,
			})
			using archive = await openPackage(destination)
			expect(Array.from(archive.entries())).not.toContain('source/original.txt')
		},
	)

	it.each<{ entries: RawEntry[]; message: string }>([
		{
			entries: [[marker[0], 'not Novelive', false]],
			message: 'media type marker',
		},
		{ entries: [['styles.css', 'css'], marker], message: 'media type marker' },
		{
			entries: [[marker[0], marker[1], true]],
			message: 'compression or encryption',
		},
		{
			entries: [marker, ['series.json', '{}']],
			message: 'conflicting entry name',
		},
		{
			entries: [marker, ['project.db', 'private']],
			message: 'unsafe entry name',
		},
		{
			entries: [marker, ['assets/NUL.webp', 'device']],
			message: 'not portable',
		},
		{
			entries: [
				marker,
				['assets/tile.webp', 'one'],
				['assets/TILE.webp', 'two'],
			],
			message: 'conflicting entry name',
		},
		{
			entries: [
				marker,
				['assets/tile.webp', 'one'],
				['assets/tile.webp/child.webp', 'two'],
			],
			message: 'conflicting entry name',
		},
		{
			entries: [marker, ['assets/tile.webp', '/outside', false, 0o120777]],
			message: 'regular ZIP file',
		},
		{
			entries: [marker, ['assets/tile.webp', 'compressed art', true]],
			message: 'compression or encryption',
		},
		{
			entries: [marker, ['assets/asset-registry.json/tile.webp', 'art']],
			message: 'file path used as a directory',
		},
		{
			entries: [marker, ['assets/ASSET-REGISTRY.JSON/tile.webp', 'art']],
			message: 'file path used as a directory',
		},
	])(
		'rejects malformed or unsafe ZIP directory: $message',
		async ({ entries, message }) => {
			const project = releasedEntries()
			for (const [path] of entries)
				if (path === 'styles.css') project.delete(path)
			await rawArchive([...entries, ...project])
			await expect(openPackage(destination)).rejects.toMatchObject({
				code: 'corrupt_package',
				message: expect.stringContaining(message),
			})
		},
	)

	it.each([
		'../styles.css',
		'/styles.css',
		'D:/styles.css',
		'assets\\tile.webp',
	])('rejects unsafe raw entry %s', async (name) => {
		await invalidNameArchive(name)
		await expect(openPackage(destination)).rejects.toMatchObject({
			code: 'corrupt_package',
		})
	})

	it.each([
		['series.json', '{', 'corrupt_package'],
		[
			'series.json',
			JSON.stringify({ ...series, formatVersion: 2 }),
			'unsupported_format',
		],
		[
			'series.json',
			JSON.stringify({ ...series, formatVersion: 0 }),
			'corrupt_package',
		],
		[
			'series.json',
			JSON.stringify({ ...series, title: false }),
			'corrupt_package',
		],
		[
			workPath,
			JSON.stringify({ ...work, version: 1, minReaderVersion: 2 }),
			'unsupported_reader',
		],
		[
			workPath,
			JSON.stringify({ ...work, workId: workB, version: 1 }),
			'corrupt_package',
		],
		[workPath, JSON.stringify(work), 'corrupt_package'],
		[
			chapterPath,
			JSON.stringify({ formatVersion: 1, chapterId: 'ch-1' }),
			'corrupt_package',
		],
		[
			'glossary.json',
			JSON.stringify({ formatVersion: 1, entries: [false] }),
			'corrupt_package',
		],
	])('checks version and schema for %s (%#)', async (path, value, code) => {
		const entries = releasedEntries().set(path, value)
		await rawArchive([marker, ...entries])
		await expect(openPackage(destination)).rejects.toMatchObject({ code })
	})

	it('rejects missing scenes and files from unlisted works', async () => {
		const entries = releasedEntries()
		entries.delete(scenePath)
		await rawArchive([marker, ...entries])
		await expect(openPackage(destination)).rejects.toThrow('missing scene')
		entries.set(scenePath, 'scene')
		entries.set(
			projectFiles.styles({
				...scope,
				workId: '00000000-0000-4000-8000-000000000004',
			}),
			'orphan',
		)
		await rawArchive([marker, ...entries])
		await expect(openPackage(destination)).rejects.toThrow('not listed')
	})

	it('detects corrupt streamed payloads and never keeps partial extraction', async () => {
		await exportPackage({ projectRoot, destination, scope })
		const bytes = await readFile(destination)
		const offset = bytes.indexOf('WebP bytes')
		expect(offset).toBeGreaterThan(0)
		bytes[offset] ^= 1
		await writeFile(destination, bytes)
		using archive = await openPackage(destination)
		const extracted = join(directory, 'extract')
		await expect(archive.extractTo(extracted)).rejects.toMatchObject({
			code: 'corrupt_package',
		})
		expect(await readdir(directory)).not.toContain('extract')

		await mkdir(extracted)
		await writeFile(join(extracted, 'keep'), 'previous import')
		await expect(archive.extractTo(extracted)).rejects.toMatchObject({
			code: 'write_failed',
		})
		expect(await readFile(join(extracted, 'keep'), 'utf8')).toBe(
			'previous import',
		)
	})

	it('rejects truncated ZIPs', async () => {
		await exportPackage({ projectRoot, destination, scope })
		const bytes = await readFile(destination)
		await writeFile(destination, bytes.subarray(0, bytes.length - 10))
		await expect(openPackage(destination)).rejects.toMatchObject({
			code: 'corrupt_package',
		})
	})

	it('runs a contiguous migration chain independently for each JSON file', () => {
		const source = Object.freeze({ formatVersion: 1, future: true })
		const steps = [
			{
				from: 1,
				to: 2,
				migrate: (file: string) => ({ ...source, formatVersion: 2, file }),
			},
			{
				from: 2,
				to: 3,
				migrate: (_path: string, document: typeof source) => ({
					...document,
					formatVersion: 3,
				}),
			},
		]
		expect(migratePackageJson('series.json', source, steps, 3)).toEqual({
			file: 'series.json',
			formatVersion: 3,
			future: true,
		})
		expect(source.formatVersion).toBe(1)
		expect(() =>
			migratePackageJson('series.json', source, steps.slice(1), 3),
		).toThrow('missing migration')
	})
})
