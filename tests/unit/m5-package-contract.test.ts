import { compile } from '@earendil-works/pi-schema'
import { workSchema } from '@novelive/format/model'
import {
	forkWorkIdentity,
	includePackageEntry,
	nextExportVersion,
	packageEntry,
	packageExtension,
	packageFormatVersion,
	packageMimetype,
	packageReaderVersion,
	packageUpdate,
	packageVersionStatus,
	packageWorkIdentity,
} from '@novelive/format/package'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { Novelive } from '../../packages/creator/src/contract'
import {
	checkShareResponse,
	type ProgressMigrationInput,
	type ProgressMigrationResult,
	shareRequest,
} from '../../packages/creator/src/contract/share'
import type {
	SaveEntry,
	WorkProgress,
} from '../../packages/player/src/contract'

const work = { workId: '3d6404ce-00cb-4de7-88a9-eb4aac4e31cf', version: 2 }
const copyId = '406f9aeb-88cb-494d-b4c8-e4c223884409'
const packagePath = '/import/book.novelive'

describe('M5 package contract', () => {
	it('uses an immutable UUID and increasing release number, with provenance on forks', () => {
		const identity = compile(packageWorkIdentity)
		expect(identity.check(work)).toBe(true)
		expect(identity.check({ ...work, workId: 'book' })).toBe(false)
		expect(identity.check({ ...work, version: 0 })).toBe(false)
		expect(nextExportVersion(0)).toBe(1)
		expect(nextExportVersion(work.version)).toBe(3)
		expect(() => nextExportVersion(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
		expect(packageUpdate(work, null)).toBe('new')
		expect(packageUpdate(work, { ...work, workId: copyId })).toBe('new')
		expect(packageUpdate(work, { ...work, version: 1 })).toBe('update')
		expect(packageUpdate(work, work)).toBe('current')
		expect(packageUpdate(work, { ...work, version: 3 })).toBe('older')
		expect(forkWorkIdentity(work, copyId)).toEqual({
			workId: copyId,
			version: 0,
			derivedFrom: work,
		})
		expect(() => forkWorkIdentity(work, work.workId)).toThrow()
	})

	it('separates unreadable package versions from corrupt same-format data', () => {
		expect(packageFormatVersion).toBe(1)
		expect(packageReaderVersion).toBe(1)
		expect(packageVersionStatus(1, 1)).toBe('current')
		expect(packageVersionStatus(2, 1)).toBe('unsupported_format')
		expect(packageVersionStatus(1, 2)).toBe('unsupported_reader')
		expect(packageVersionStatus(1, '1')).toBe('invalid_version')
		expect(packageVersionStatus(0)).toBe('invalid_version')
		expect(
			compile(workSchema).check({
				...work,
				formatVersion: 1,
				minReaderVersion: 1,
			}),
		).toBe(false)
	})

	it('defines a first stored MIME marker, stored WebP, and deflated text', () => {
		expect(packageExtension).toBe('.novelive')
		expect(packageMimetype).toEqual({
			path: 'mimetype',
			index: 0,
			content: 'application/vnd.novelive+zip',
			compression: 'store',
		})
		expect(packageEntry('mimetype')).toEqual({
			kind: 'mimetype',
			compression: 'store',
		})
		expect(packageEntry('assets/style/main-visual.webp')).toEqual({
			kind: 'content',
			compression: 'store',
		})
		for (const path of [
			'series.json',
			'volumes/vol_1/volume.json',
			'volumes/vol_1/styles.css',
			`volumes/vol_1/works/${work.workId}/work.json`,
			`volumes/vol_1/works/${work.workId}/chapters/ch_1/00000001.nvs`,
		]) {
			expect(packageEntry(path)).toEqual({
				kind: 'content',
				compression: 'deflate',
			})
		}
		expect(packageEntry('source/images/插图.webp')).toEqual({
			kind: 'source',
			compression: 'store',
		})
		expect(includePackageEntry('source/original.epub')).toBe(false)
		expect(includePackageEntry('source/original.epub', true)).toBe(true)
		expect(
			includePackageEntry('source/imports/vol_1/original.epub', true),
		).toBe(true)
	})

	it.each([
		'project.db',
		'candidates/cover.webp',
		'save-data/progress.json',
		'source/production/private.json',
		'source/preview/private.exe',
		'../series.json',
		'/series.json',
		'C:/series.json',
		'assets\\picture.webp',
		'assets/../picture.webp',
		'assets//picture.webp',
		'bible/./style.json',
	])(
		'does not accept %s as an archive entry even with sources selected',
		(path) => {
			expect(packageEntry(path)).toBeUndefined()
			expect(includePackageEntry(path, true)).toBe(false)
		},
	)
})

describe('M5 desktop share and migration contracts', () => {
	const selection = {
		projectRoot: '/projects/book',
		scope: { level: 'work', volumeId: 'vol_1', workId: work.workId },
		includeSource: false,
	}
	const approval = {
		workId: work.workId,
		installedVersion: 1,
		incomingVersion: 2,
	}

	it('validates host requests for preview, export, inspect, import, and import-as-project', () => {
		for (const request of [
			{ operation: 'previewExport', ...selection },
			{ operation: 'export', ...selection, destination: packagePath },
			{ operation: 'inspectImport', packagePath },
			{ operation: 'import', packagePath, approvedUpdates: [] },
			{ operation: 'import', packagePath, approvedUpdates: [approval] },
			{
				operation: 'importAsProject',
				packagePath,
				destination: '/projects/copy',
			},
		])
			expect(shareRequest.check(request)).toBe(true)
		for (const request of [
			{ operation: 'export', ...selection },
			{ operation: 'previewExport', ...selection, scope: { level: 'volume' } },
			{ operation: 'inspectImport', packagePath: '' },
			{ operation: 'import', packagePath, approvedUpdates: true },
			{
				operation: 'import',
				packagePath,
				approvedUpdates: [approval, approval],
			},
			{ operation: 'importAsProject', packagePath, destination: '' },
		])
			expect(shareRequest.check(request)).toBe(false)
	})

	it('validates result payloads and preserves distinct errors for bad and too-new packages', () => {
		for (const result of [
			{
				operation: 'previewExport',
				warnings: [
					{ workId: work.workId, chapterId: 'ch_1', title: 'Chapter 1' },
				],
			},
			{ operation: 'export', works: [work] },
			{
				operation: 'inspectImport',
				works: [
					{ relation: 'update', work, title: 'Book', installedVersion: 1 },
				],
			},
			{ operation: 'import', works: [work] },
			{
				operation: 'importAsProject',
				projectRoot: '/projects/copy',
				workIds: [copyId],
			},
		] as const)
			expect(checkShareResponse(result.operation, { ok: true, result })).toBe(
				true,
			)
		for (const code of [
			'corrupt_package',
			'unsupported_format',
			'unsupported_reader',
			'write_failed',
			'stale_import',
		]) {
			expect(
				checkShareResponse('inspectImport', {
					ok: false,
					error: { code, message: 'Cannot import' },
				}),
			).toBe(true)
		}
		expect(
			checkShareResponse('inspectImport', {
				ok: true,
				result: {
					operation: 'inspectImport',
					works: [{ relation: 'update', work, title: 'Book' }],
				},
			}),
		).toBe(false)
	})

	it('rejects a valid success payload for a different operation', () => {
		const response: unknown = {
			ok: true,
			result: { operation: 'export', works: [work] },
		}
		expect(checkShareResponse('inspectImport', response)).toBe(false)
		if (!checkShareResponse('export', response) || !response.ok)
			throw new Error('Expected a valid export response')
		expectTypeOf(response.result.operation).toEqualTypeOf<'export'>()
	})

	it('types host results by operation and keeps old saves versioned outside WorkProgress', () => {
		const inspect = (api: NonNullable<Novelive['host']['share']>) =>
			api.call({ operation: 'inspectImport', packagePath })
		type Inspected = Extract<Awaited<ReturnType<typeof inspect>>, { ok: true }>
		expectTypeOf<
			Inspected['result']['operation']
		>().toEqualTypeOf<'inspectImport'>()
		expectTypeOf<
			ProgressMigrationInput['progress']
		>().toEqualTypeOf<WorkProgress>()
		expectTypeOf<ProgressMigrationInput['positions'][number]>().toEqualTypeOf<{
			chapterId: string
			sceneId: string
			sentenceId: string
		}>()
		expectTypeOf<
			ProgressMigrationResult['legacySaves'][number]
		>().toEqualTypeOf<{
			version: number
			saves: readonly SaveEntry[]
		}>()
	})
})
