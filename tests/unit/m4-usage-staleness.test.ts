import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '@novelive/format/model'
import { expect, test, vi } from 'vitest'
import { propagateStaleness } from '../../packages/creator/src/bible/staleness'
import { createConfigStore } from '../../packages/creator/src/config'
import * as artModels from '../../packages/creator/src/pipeline/art/models'
import { Project } from '../../packages/creator/src/project'
import {
	chapterWorker,
	productionModels,
} from '../../packages/creator/src/project/production-worker'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import {
	listUsage,
	recordImageUsage,
	recordTextUsage,
} from '../../packages/creator/src/usage'
import { bible } from '../fixtures/cassettes/m1b-art/fixture'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'

const workId = '00000000-0000-0000-0000-000000000001'

async function fixture(
	run: (project: Project, profile: string) => Promise<void>,
) {
	const root = await mkdtemp(join(tmpdir(), 'm4-usage-unit-'))
	try {
		using project = await Project.create(join(root, 'project'), {
			formatVersion,
			seriesId: 'usage',
			title: 'Usage',
			volumeIds: ['v1'],
		})
		await project.write(projectFiles.volume('v1'), {
			formatVersion,
			volumeId: 'v1',
			title: 'Volume',
			workIds: [workId],
		})
		await project.write(projectFiles.work('v1', workId), {
			formatVersion,
			workId,
			title: 'Work',
			chapterIds: [],
			version: 0,
			minReaderVersion: 1,
			appVersion: '0.1.0',
			language: 'en',
			settings: defaultWorkSettings(),
		})
		project.tasks.registerWork({ workId, title: 'Work' })
		const profile = join(root, 'profile')
		await mkdir(join(profile, 'projects'), { recursive: true })
		await writeFile(join(profile, 'projects', workId), project.root)
		await run(project, profile)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

test('visual-confirmation portraits without drawing tasks appear in the stale projection', async () => {
	await fixture(async (project, profile) => {
		const before = await readBible(project)
		before.character = [
			{
				id: 'ada',
				name: 'Ada',
				aliases: [],
				status: 'confirmed',
				appearance: { description: 'Black hair' },
				costumes: [{ id: 'uniform', description: 'Uniform' }],
			},
		]
		await project.write(projectFiles.assetRegistry({ level: 'series' }), {
			formatVersion,
			entries: [
				{
					id: 'ada/uniform/neutral',
					type: 'character',
					path: 'assets/portrait.webp',
					status: 'drawn',
					aliases: [],
				},
			],
		})
		expect(project.database.prepare('SELECT * FROM asset').all()).toEqual([])
		const after = structuredClone(before)
		after.character[0].appearance = { description: 'Silver hair' }
		await propagateStaleness(project, before, after)
		expect((await listUsage(profile)).staleAssets).toEqual([
			{ workId, assetKey: 'ada/uniform/neutral' },
		])
	})
})

test('characters and locations with the same Bible id invalidate only their own asset family', async () => {
	await fixture(async (project, profile) => {
		const before = await readBible(project)
		before.character = [
			{
				id: 'shared',
				name: 'Ada',
				aliases: [],
				status: 'confirmed',
				appearance: { description: 'Black hair' },
			},
		]
		before.location = [
			{
				id: 'shared',
				name: 'Room',
				status: 'confirmed',
				description: 'Old room',
			},
		]
		await project.write(projectFiles.assetRegistry({ level: 'series' }), {
			formatVersion,
			entries: [
				{
					id: 'shared/uniform/neutral',
					type: 'character',
					path: 'assets/portrait.webp',
					status: 'drawn',
					aliases: [],
				},
				{
					id: 'shared/day',
					type: 'location',
					path: 'assets/room.webp',
					status: 'drawn',
					aliases: [],
				},
			],
		})
		for (const id of ['shared/uniform/neutral', 'shared/day'])
			project.database
				.prepare(
					"INSERT INTO asset(work_id, asset_key, kind, status) VALUES (?, ?, 'base', 'drawn')",
				)
				.run(workId, id)
		const appearance = structuredClone(before)
		appearance.character[0].appearance = { description: 'Silver hair' }
		await propagateStaleness(project, before, appearance)
		expect(
			(await listUsage(profile)).staleAssets.map((row) => row.assetKey),
		).toEqual(['shared/uniform/neutral'])
		project.database.exec("UPDATE asset SET status = 'drawn'")
		const location = structuredClone(before)
		location.location[0].description = 'New room'
		await propagateStaleness(project, before, location)
		expect(
			(await listUsage(profile)).staleAssets.map((row) => row.assetKey),
		).toEqual(['shared/day'])
	})
})

test('chapterWorker and its ArtProduction attribute asynchronous model usage without a caller usage scope', async () => {
	vi.stubEnv('NL_REPLAY', 'strict')
	const network = vi.fn(async () => {
		throw new Error('Network forbidden')
	})
	vi.stubGlobal('fetch', network)
	const usage = {
		input: 11,
		output: 7,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 18,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	}
	vi.spyOn(artModels, 'artJson').mockImplementation(
		async (connection, prompt) => {
			await Promise.resolve()
			recordTextUsage(connection.model, usage)
			return (
				prompt.startsWith('Write only visible content')
					? { content: 'A classroom' }
					: { patch: '', items: [], merges: {} }
			) as never
		},
	)
	const painted = new Error('Stop after recording the returned image')
	vi.spyOn(artModels, 'imageRenderer').mockImplementation(
		(config) => async () => {
			await Promise.resolve()
			recordImageUsage(config.model, 1)
			throw painted
		},
	)
	try {
		await fixture(async (project, profile) => {
			const config = createConfigStore(profile)
			await config.update(configuration)
			const work = await project.read(projectFiles.work('v1', workId))
			await project.write(
				projectFiles.chapter({ volumeId: 'v1', workId, chapterId: 'c1' }),
				{
					formatVersion,
					chapterId: 'c1',
					title: 'Boat',
					sceneIds: [],
					paragraphIds: ['p0001'],
					cg: [],
				},
			)
			await project.writeFile(
				projectFiles.chapterText('c1'),
				'A paper boat drifts under the bridge.\n',
			)
			await project.writeFile(
				'source/production/c1/draft.nvs',
				'scene Boat\nsource p0001-p0001\n\n: A paper boat drifts under the bridge.\n',
			)
			const { worker, art } = chapterWorker(
				project,
				'v1',
				work,
				await productionModels(config),
				{ mode: 'strict', fetch: network },
			)
			await worker.stage({
				workId,
				chapterId: 'c1',
				link: 'none',
				desensitized: false,
				signal: new AbortController().signal,
			})
			await expect(art().candidates(bible, ['c1'])).rejects.toBe(painted)
			const records = (await listUsage(profile)).records.map(
				({ usage: row }) => ({
					workId: row.link.workId,
					phase: row.phase,
					kind: row.kind,
				}),
			)
			expect(records).toEqual(
				expect.arrayContaining([
					{ workId, phase: 'stage', kind: 'text' },
					{ workId, phase: 'draw', kind: 'text' },
					{ workId, phase: 'draw', kind: 'image' },
				]),
			)
			expect(records).toHaveLength(3)
			expect(network).not.toHaveBeenCalled()
		})
	} finally {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
		vi.unstubAllEnvs()
	}
})

test('usage keeps readable history and distinguishes broken bindings from empty projects', async () => {
	await fixture(async (project, profile) => {
		expect(await listUsage(join(profile, 'empty'))).toEqual({
			records: [],
			staleAssets: [],
			unreadableProjects: [],
		})
		expect(await listUsage(profile)).toEqual({
			records: [],
			staleAssets: [],
			unreadableProjects: [],
		})
		project.database
			.prepare(
				"INSERT INTO usage(usage_id,work_id,at,slot,purpose,model,usage_input,usage_output,usage_cache_read,usage_cache_write) VALUES ('usage', ?, 1, 'main', 'write', 'fixture', 11, 7, 0, 0)",
			)
			.run(workId)
		const history = await listUsage(profile)
		await writeFile(join(profile, 'projects', 'duplicate'), project.root)
		await writeFile(
			join(profile, 'projects', 'moved'),
			join(profile, 'missing'),
		)
		await mkdir(join(profile, 'projects', 'invalid-binding'))
		const partial = await listUsage(profile)
		expect(partial.records).toEqual(history.records)
		expect(partial.records).toHaveLength(1)
		expect(partial.unreadableProjects).toEqual([
			{ projectId: 'invalid-binding', reason: '项目无法读取' },
			{ projectId: 'moved', reason: '项目已移动或不存在' },
		])
	})
})
