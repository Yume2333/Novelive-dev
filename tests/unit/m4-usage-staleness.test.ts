import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '@novelive/format/model'
import { expect, test } from 'vitest'
import { propagateStaleness } from '../../packages/creator/src/bible/staleness'
import { Project } from '../../packages/creator/src/project'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import { listUsage } from '../../packages/creator/src/usage'

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
