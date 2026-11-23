import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	defaultWorkSettings,
	formatVersion,
	projectFiles,
} from '@novelive/format/model'
import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import {
	applyBibleProposal,
	bibleRevision,
	getBible,
} from '../../packages/creator/src/bible/editing'
import { propagateStaleness } from '../../packages/creator/src/bible/staleness'
import { ChatStore } from '../../packages/creator/src/chat/store'
import { createConfigStore } from '../../packages/creator/src/config'
import { testTextConnection } from '../../packages/creator/src/models/text'
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
	withUsage,
} from '../../packages/creator/src/usage'
import { approvalNotice } from '../../packages/ui/src/pages/bible/BiblePage'
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

test.each(['appearance', 'costume'] as const)(
	'real visual confirmation without drawing tasks projects portraits stale after a %s edit',
	async (change) => {
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
			const config = createConfigStore(profile)
			await config.update(configuration)
			const network = vi.fn(async () => {
				throw new Error('Network forbidden')
			})
			const { art } = chapterWorker(
				project,
				'v1',
				await project.read(projectFiles.work('v1', workId)),
				await productionModels(config),
				{ mode: 'strict', fetch: network },
			)
			const service = art()
			await project.writeFile(
				'source/candidate.png',
				await sharp({
					create: { width: 4, height: 4, channels: 4, background: '#eeeeee' },
				})
					.png()
					.toBuffer(),
			)
			const candidate = { id: 'approved', cachePath: 'source/candidate.png' }
			await service.confirmVisual(
				bible.style,
				{
					mainVisuals: [candidate],
					supplemental: [],
					characters: [
						{
							characterId: 'ada',
							costumeId: 'uniform',
							candidates: [candidate],
						},
					],
				},
				{
					mainVisualId: candidate.id,
					supplementalIds: [],
					characters: [
						{
							characterId: 'ada',
							costumeId: 'uniform',
							candidateId: candidate.id,
						},
					],
				},
			)
			expect((await service.registry()).entries).toEqual([
				expect.objectContaining({
					id: 'ada/uniform/neutral',
					type: 'character',
					status: 'drawn',
				}),
			])
			expect(project.database.prepare('SELECT * FROM asset').all()).toEqual([])
			expect(project.database.prepare('SELECT * FROM task').all()).toEqual([])
			const after = structuredClone(before)
			if (change === 'appearance')
				after.character[0].appearance = { description: 'Silver hair' }
			else {
				const costume = after.character[0].costumes?.[0]
				if (!costume) throw new Error('Missing fixture costume')
				costume.description = 'New uniform'
			}
			await propagateStaleness(project, before, after)
			expect((await listUsage(profile)).staleAssets).toEqual([
				{ workId, assetKey: 'ada/uniform/neutral' },
			])
			expect(network).not.toHaveBeenCalled()
		})
	},
)

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

test('image rendering requests one image and meters all returned images', async () => {
	await fixture(async (project) => {
		const model = 'fixture-single-image'
		const first = Buffer.from('first image')
		const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
			const request = new Request(input, init)
			const pathname = new URL(request.url).pathname
			if (pathname === '/v1/images/edits') {
				expect((await request.formData()).get('n')).toBe('1')
			} else {
				expect(pathname).toBe('/v1/images/generations')
				expect(await request.json()).toMatchObject({ n: 1 })
			}
			return Response.json({
				data: [
					{ b64_json: first.toString('base64') },
					{ url: 'https://relay.invalid/unused-second-image.png' },
				],
			})
		})
		const render = artModels.imageRenderer(
			{
				...configuration.models.image,
				model,
				baseUrl: 'https://relay.invalid/v1',
				upscaleTier: 'anime',
			},
			{
				replay: {
					mode: 'replay',
					directory: join(project.root, 'offline'),
					fetch,
				},
			},
		)
		for (const refs of [[], [Buffer.from('reference')]]) {
			expect(
				await withUsage(project, workId, 'draw', () =>
					render('A sprite', refs, { width: 1024, height: 1536 }, true),
				),
			).toEqual({ bytes: first })
		}
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(
			project.database
				.prepare('SELECT model, image_count FROM usage ORDER BY rowid')
				.all(),
		).toEqual([
			{ model, image_count: 2 },
			{ model, image_count: 2 },
		])
	})
})

test('text provider usage preserves resolved slots even when every slot uses the same model', async () => {
	vi.stubEnv('NL_REPLAY', 'strict')
	try {
		await fixture(async (project, profile) => {
			const store = createConfigStore(profile)
			const connection = configuration.models.fast
			await store.update({
				models: {
					fast: connection,
					main: { ...connection, inheritFast: false },
					writing: { ...connection, inheritFast: false },
					visual: { ...connection, inheritFast: false },
				},
			})
			const fetch = vi.fn<typeof globalThis.fetch>(async () => {
				const chunks = [
					{ choices: [{ index: 0, delta: { content: 'OK' } }] },
					{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
					{ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } },
				]
				return new Response(
					`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
					{ headers: { 'content-type': 'text/event-stream' } },
				)
			})
			for (const slot of ['fast', 'main', 'writing', 'visual'] as const) {
				const model = await store.resolveTextModel(slot)
				await withUsage(project, workId, 'write', () =>
					testTextConnection(model, { fetch }),
				)
			}
			expect(
				project.database
					.prepare(
						'SELECT slot, usage_input, usage_output FROM usage ORDER BY at, rowid',
					)
					.all(),
			).toEqual(
				['fast', 'main', 'writing', 'visual'].map((slot) => ({
					slot,
					usage_input: 11,
					usage_output: 7,
				})),
			)
			expect(fetch).toHaveBeenCalledTimes(4)
		})
	} finally {
		vi.unstubAllEnvs()
	}
})

test('approving a general character description marks the base sprite and expression stale and reports it', async () => {
	await fixture(async (project, profile) => {
		const character = {
			id: 'ada',
			name: 'Ada',
			aliases: [],
			status: 'confirmed' as const,
			description: 'A red fox.',
		}
		const file = projectFiles.character({ level: 'series' }, character.id)
		await project.write(file, { formatVersion, entries: [character] })
		const base = 'ada/default/neutral'
		const expression = 'ada/default/curious'
		const unrelated = 'bea/default/neutral'
		const insert = project.database.prepare(
			"INSERT INTO asset(work_id, asset_key, kind, base_key, status) VALUES (?, ?, ?, ?, 'drawn')",
		)
		insert.run(workId, base, 'base', null)
		insert.run(workId, expression, 'variant', base)
		insert.run(workId, unrelated, 'base', null)
		const updated = { ...character, description: 'A silver fox.' }
		const payload = {
			kind: 'bible',
			volumeId: 'v1',
			expectedRevision: bibleRevision(await readBible(project)),
			changes: [
				{
					kind: 'character',
					op: 'update',
					entry: { ...updated, status: 'candidate' },
				},
			],
		}
		project.database
			.prepare(
				'INSERT INTO proposal(proposal_id, work_id, kind, prompt, payload, created_at) VALUES (?, ?, ?, ?, ?, 0)',
			)
			.run(
				'edit',
				workId,
				payload.kind,
				'Edit',
				JSON.stringify({ chapterIds: [], payload }),
			)
		const { proposal } = new ChatStore(project.database, workId).proposal(
			'edit',
		)
		const before = await getBible(project, { workId, volumeId: 'v1' })
		await expect(applyBibleProposal(project, proposal)).resolves.toEqual({
			status: 'applied',
		})
		expect(approvalNotice(proposal, before)).toBe(
			'已接受候选；受影响的已有图片已标记过期。',
		)
		expect((await project.read(file)).entries).toEqual([updated])
		expect((await listUsage(profile)).staleAssets).toEqual([
			{ workId, assetKey: expression },
			{ workId, assetKey: base },
		])
	})
})

test.each(['style', 'glossary'] as const)(
	'%s proposal approval ignores malformed asset registries when nothing becomes stale',
	async (kind) => {
		await fixture(async (project) => {
			if (kind === 'style')
				await project.write(projectFiles.style({ level: 'series' }), {
					formatVersion,
					entries: [
						{ id: 'style', description: 'Original style', status: 'confirmed' },
					],
				})
			const registry = projectFiles.assetRegistry({ level: 'series' })
			await project.writeFile(registry.path, '{"invalid":"registry"}')
			await expect(project.read(registry)).rejects.toBeDefined()
			const base = {
				volumeId: 'v1',
				expectedRevision: bibleRevision(await readBible(project)),
			}
			const payload =
				kind === 'style'
					? {
							...base,
							kind: 'bible',
							changes: [
								{
									kind: 'style',
									op: 'update',
									entry: {
										id: 'style',
										description: 'Ink wash',
										status: 'candidate',
									},
								},
							],
						}
					: {
							...base,
							kind: 'glossary',
							changes: [
								{
									id: 'boat',
									original: 'boat',
									written: 'Boat',
									category: 'object',
									status: 'candidate',
								},
							],
						}
			project.database
				.prepare(
					'INSERT INTO proposal(proposal_id, work_id, kind, prompt, payload, created_at) VALUES (?, ?, ?, ?, ?, 0)',
				)
				.run(
					'edit',
					workId,
					payload.kind,
					'Edit',
					JSON.stringify({ chapterIds: [], payload }),
				)
			const proposal = new ChatStore(project.database, workId).proposal(
				'edit',
			).proposal
			const reads = vi.spyOn(project, 'read')
			try {
				await expect(applyBibleProposal(project, proposal)).resolves.toEqual({
					status: 'applied',
				})
				expect(
					reads.mock.calls.some(([file]) => file.path === registry.path),
				).toBe(false)
			} finally {
				reads.mockRestore()
			}
			const after = await readBible(project)
			if (kind === 'style')
				expect(after.style).toEqual([
					expect.objectContaining({
						description: 'Ink wash',
						status: 'confirmed',
					}),
				])
			else
				expect(after.glossary).toEqual([
					expect.objectContaining({
						original: 'boat',
						written: 'Boat',
						status: 'confirmed',
					}),
				])
			expect(
				project.database
					.prepare("SELECT * FROM asset WHERE status = 'stale'")
					.all(),
			).toEqual([])
		})
	},
)
