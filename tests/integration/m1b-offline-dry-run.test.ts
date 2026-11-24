import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { compileScript } from '@novelive/format/script'
import { expect, test, vi } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'
import { importTxtProject } from '../../packages/creator/src/import/wizard'
import { playbackAssetIds } from '../../packages/creator/src/pipeline/art/plan'
import { Project } from '../../packages/creator/src/project'
import { createProduction } from '../../packages/creator/src/project/production'
import { createReplayFetch } from '../../packages/creator/src/replay'
import { projectSpend } from '../../packages/creator/src/usage/spend'
import { evaluate } from '../../tools/quality/scorer'
import { configuration } from '../fixtures/cassettes/m1b-gate/fixture'
import {
	book,
	chapterIds,
	chapters,
	type Fault,
	fakeRelay,
} from '../fixtures/m1b-offline-relay'

const scenarios: { name: string; faults: Fault[] }[] = [
	{ name: 'clean', faults: [] },
	...(
		[
			'malformed',
			'invalid-id',
			'over-budget',
			'staging-503',
			'writing-503',
			'missing-usage',
			'truncated',
			'rate-limit',
			'review-rate-limit',
			'image-failure',
			'image-null',
			'image-invalid-json',
			'download-failure',
			'download-body-failure',
			'soft-stop',
		] as const
	).map((fault) => ({ name: fault, faults: [fault] })),
	{
		name: 'review-cap-raise',
		faults: ['review-reasoning', 'review-rate-limit'],
	},
	{
		name: 'review-raised-cap-rate-limit',
		faults: ['review-reasoning', 'review-raised-cap-rate-limit'],
	},
	{
		name: 'mixed',
		faults: [
			'writing-503',
			'malformed',
			'staging-503',
			'invalid-id',
			'truncated',
			'missing-usage',
			'image-failure',
			'image-null',
			'image-invalid-json',
			'rate-limit',
			'review-rate-limit',
			'over-budget',
			'soft-stop',
			'download-failure',
			'download-body-failure',
		],
	},
]

test.each(scenarios)(
	'offline four-chapter production: $name',
	async ({ name, faults }) => {
		const root = await mkdtemp(join(tmpdir(), 'novelive-m1b-offline-'))
		const relay = fakeRelay(faults)
		const profile = join(root, 'profile')
		const config = createConfigStore(profile)
		const createHost = () =>
			createProduction(
				profile,
				config,
				{ fetch: relay.fetch },
				() => {},
				() => {},
			)
		let host = createHost()
		let window = 0
		const startWindow = () => {
			window++
			vi.stubEnv('NL_RUN_ID', `offline-${window}`)
			vi.stubEnv('NL_USAGE_CSV', join(root, `usage-${window}.csv`))
		}
		try {
			vi.stubGlobal('fetch', () => {
				throw new Error('Network is forbidden in the dry run')
			})
			vi.stubEnv('NL_REPLAY', '')
			vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
			vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '0.8')
			vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
			startWindow()
			const sourcePath = join(root, 'river.txt')
			await writeFile(sourcePath, book)
			await config.update({
				...configuration,
				models: {
					...configuration.models,
					fast: { ...configuration.models.fast, contextWindow: 8192 },
					...(faults.includes('review-reasoning') && {
						main: {
							...configuration.models.main,
							model: 'devin-swe-2',
							maxOutputTokens: null,
						},
					}),
					image: { ...configuration.models.image, retries: 3 },
				},
				production: { roleModels: { artist: 'fast' } },
			})
			const result = await importTxtProject({
				sourcePath,
				folder: root,
				title: '河边手记',
				references: [],
				encoding: 'utf-8',
			})
			expect(result.status).toBe('ready')
			if (result.status !== 'ready') throw new Error('Fixture did not import')
			const { workId, projectDir } = result
			using project = await Project.open(projectDir)
			const series = await project.read(projectFiles.series)
			expect(series.volumeIds).toEqual(['v0001'])
			const work = await project.read(projectFiles.work('v0001', workId))
			expect(work.chapterIds).toEqual(chapterIds)
			expect(
				(await project.readFile(projectFiles.original('txt'))).toString(),
			).toBe(book)
			const reservations = () =>
				project.database
					.prepare(
						'SELECT id, run_id, tokens, images, actual_tokens, actual_images FROM spend_reservation ORDER BY id',
					)
					.all() as {
					id: number
					run_id: string
					tokens: number
					images: number
					actual_tokens: number | null
					actual_images: number | null
				}[]
			await host.remember(workId, projectDir)
			let session = await host.get(workId)
			const { phase, visual } = session.snapshot()
			expect(phase).toBe('confirm-visual')
			expect(visual?.mainVisuals).toHaveLength(3)
			expect(visual?.characters).toHaveLength(1)
			await session.confirm({
				workId,
				mainVisualId: 'visual-1',
				supplementalIds: [],
				characters: [
					{
						characterId: 'ada',
						costumeId: 'uniform',
						candidateId: 'costume-1',
					},
				],
			})
			const reopen = async (newWindow = false) => {
				await host.close()
				const previous = reservations()
				const calls = relay.admissions.length
				if (newWindow) startWindow()
				host = createHost()
				session = await host.get(workId)
				await session.queue.idle()
				expect(relay.admissions).toHaveLength(calls)
				expect(reservations()).toEqual(previous)
			}
			const play = async (chapterId: string) => {
				const player = await host.player(workId, undefined, chapterId)
				const compiled = compileScript(player.script, {
					assets: player.registry.entries,
					speakers: player.speakers,
					customMarks: Object.keys(player.customMarks),
					paragraphIds: player.chapter.paragraphIds,
					sceneIds: player.chapter.sceneIds,
				})
				expect(compiled.diagnostics).toEqual([])
				expect(compiled.ok && compiled.scenes).toHaveLength(2)
				if (!compiled.ok) throw new Error('Player compilation failed')
				const used = playbackAssetIds(compiled.scenes)
				expect(used.size).toBeGreaterThan(0)
				for (const id of used) {
					const entry = player.registry.entries.find((asset) => asset.id === id)
					expect(entry?.path).toMatch(/^player\/(?!unavailable\/)/)
					expect(
						(await readFile(join(profile, 'cache', entry?.path ?? ''))).length,
					).toBeGreaterThan(0)
				}
				return player
			}
			let passedSecondGate = false
			let resumedBudget = false
			const retriedFaults = new Set<Fault>()
			const explicitAdmissions = new Set<number>()
			for (let attempts = 0; attempts < faults.length + 6; attempts++) {
				await session.queue.idle()
				const snapshot = session.snapshot()
				if (snapshot.phase === 'done') break
				if (snapshot.phase === 'confirm-first') {
					expect(passedSecondGate).toBe(false)
					await play(chapterIds[0])
					expect(
						(await host.playerStatus(workId)).chapters.map(
							({ published }) => published,
						),
					).toEqual([true, false, false, false])
					passedSecondGate = true
					if (relay.pending.delete('soft-stop')) {
						const target = 1_596_000
						const used = reservations().reduce(
							(sum, row) => sum + (row.actual_tokens ?? row.tokens),
							0,
						)
						const fill = await projectSpend(project.database)(
							new Request('https://relay.invalid/v1/chat/completions', {
								method: 'POST',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({
									model: 'offline-window-fill',
									messages: [],
									max_tokens: target - used,
								}),
							}),
							(request) => relay.fetch(request),
						)
						expect(fill.ok).toBe(true)
					}
					await session.continue()
					continue
				}
				const softStop =
					project.database
						.prepare('SELECT pause_reason FROM work WHERE work_id = ?')
						.get(workId)?.pause_reason === 'budget_paused'
				if (!snapshot.blockedChapterId && !softStop)
					throw new Error(
						`Unexpected offline state: ${JSON.stringify(snapshot)}`,
					)
				const previous = reservations()
				const last = relay.admissions.at(-1)
				if (last?.fault) retriedFaults.add(last.fault)
				await reopen(softStop)
				if (softStop) {
					resumedBudget = true
					await session.continue()
				} else if (snapshot.blockedChapterId) {
					explicitAdmissions.add(relay.admissions.length)
					await session.retry(snapshot.blockedChapterId)
				}
				await session.queue.idle()
				for (const row of previous)
					expect(reservations().find(({ id }) => id === row.id)).toEqual(row)
			}
			expect(session.snapshot().phase, JSON.stringify(session.snapshot())).toBe(
				'done',
			)
			expect(passedSecondGate).toBe(true)
			expect(resumedBudget).toBe(faults.includes('soft-stop'))
			for (const fault of [
				'staging-503',
				'writing-503',
				'missing-usage',
				'truncated',
			] as const) {
				if (faults.includes(fault))
					expect(
						retriedFaults.has(fault),
						`${fault} must pause before Retry`,
					).toBe(true)
			}
			expect(
				(await host.playerStatus(workId)).chapters.map(
					({ published }) => published,
				),
			).toEqual([true, true, true, true])
			const players = []
			for (const chapterId of chapterIds) players.push(await play(chapterId))
			await reopen()
			expect(session.snapshot().phase).toBe('done')
			for (const [i, chapterId] of chapterIds.entries())
				expect(await play(chapterId)).toEqual(players[i])
			if (faults.includes('over-budget')) {
				expect(
					project.database
						.prepare(
							"SELECT run_id FROM run WHERE json_array_length(meta, '$.stageTrim') > 0",
						)
						.all().length,
				).toBeGreaterThan(0)
			}

			const report = await evaluate(
				await Promise.all(
					chapterIds.map(async (id, i) => ({
						id,
						producer: configuration.models.writing.model,
						speakers: ['ada'],
						bible: '阿妲追着河中的纸船。',
						maxLineChars: 50,
						source: chapters[i].map((text, offset) => ({
							id: `p000${offset + 1}`,
							text,
						})),
						script: (
							await project.readFile(`source/production/${id}/draft.nvs`)
						).toString('utf8'),
					})),
				),
				{ ...configuration.models.main, model: 'fixture-quality' },
				createReplayFetch({
					fetch: relay.fetch,
					spend: projectSpend(project.database),
				}),
			)
			expect(report.trials.map(({ verdict }) => verdict)).toEqual([
				'pass',
				'pass',
				'pass',
				'pass',
			])
			expect([...relay.pending]).toEqual([])
			expect(relay.downloads).toBeGreaterThan(0)
			for (const [i, admission] of relay.admissions.entries()) {
				if (
					!admission.fault ||
					!['staging-503', 'writing-503', 'missing-usage'].includes(
						admission.fault,
					)
				)
					continue
				const next = relay.admissions.findIndex(
					(row, j) => j > i && row.requestKey === admission.requestKey,
				)
				expect(next, admission.fault).toBeGreaterThan(i)
				expect([...explicitAdmissions].some((j) => i < j && j <= next)).toBe(
					true,
				)
			}
			const stageKeys = relay.admissions.filter(
				({ operation, tokens, fault }) =>
					operation === 'stage' && tokens !== null && fault !== 'truncated',
			)
			for (const { requestKey } of stageKeys) {
				const matches = stageKeys.filter((row) => row.requestKey === requestKey)
				expect(
					matches,
					JSON.stringify(
						matches.map(({ chapter, fault, run }) => ({ chapter, fault, run })),
					),
				).toHaveLength(1)
			}
			const writeKeys = relay.admissions
				.filter(
					({ operation, tokens }) => operation === 'write' && tokens !== null,
				)
				.map(({ requestKey }) => requestKey)
			expect(writeKeys).toHaveLength(new Set(writeKeys).size)
			const reviews = relay.admissions.filter(
				({ operation }) => operation === 'review',
			)
			const settledReviewKeys = reviews
				.filter(({ tokens }) => tokens !== null)
				.map(({ requestKey }) => requestKey)
			expect(settledReviewKeys).toHaveLength(new Set(settledReviewKeys).size)
			const reviewDenial = faults.find(
				(fault) =>
					fault === 'review-rate-limit' ||
					fault === 'review-raised-cap-rate-limit',
			)
			if (reviewDenial) {
				const denied = reviews.findIndex(({ fault }) => fault === reviewDenial)
				const raised = faults.includes('review-reasoning')
				expect(denied).toBe(
					raised && reviewDenial === 'review-rate-limit' ? 2 : 1,
				)
				expect(reviews[0].tokens).not.toBeNull()
				if (raised) {
					expect(reviews[0].fault).toBe('review-reasoning')
					expect(reviews[1].outputCap).toBeGreaterThan(
						reviews[0].outputCap ?? Infinity,
					)
				}
				if (reviewDenial === 'review-raised-cap-rate-limit') {
					expect(reviews[denied].tokens).toBeNull()
					expect(explicitAdmissions.size).toBe(0)
					const chapterRuns = session.queue
						.runLog(workId)
						.filter(
							({ kind, ref }) => kind === 'chapter' && ref === chapterIds[0],
						)
					expect(chapterRuns).toHaveLength(1)
					const reviewSteps = chapterRuns[0].steps.filter(
						({ purpose }) => purpose === 'review',
					)
					expect(reviewSteps).toMatchObject([
						{ status: 'failed', errorType: 'transient' },
						{ status: 'completed', errorType: null },
					])
					expect(
						reviews.filter(
							({ requestKey }) => requestKey === reviews[0].requestKey,
						),
					).toHaveLength(1)
					expect(
						reviews.filter(
							({ requestKey }) => requestKey === reviews[denied].requestKey,
						),
					).toHaveLength(2)
				}
				expect(reviews[denied + 1].requestKey).toBe(reviews[denied].requestKey)
				expect(reviews[denied + 1].tokens).not.toBeNull()
				expect(
					project.database
						.prepare(
							"SELECT COUNT(*) AS requests, SUM(usage_input + usage_output + usage_cache_read + usage_cache_write) AS tokens FROM usage WHERE purpose = 'review'",
						)
						.get(),
				).toEqual({
					requests: reviews.length,
					tokens: reviews.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
				})
			}
			for (const failed of relay.admissions.filter(
				({ fault }) =>
					fault === 'image-failure' ||
					fault === 'image-null' ||
					fault === 'image-invalid-json' ||
					fault === 'download-failure' ||
					fault === 'download-body-failure',
			)) {
				expect(
					relay.admissions.filter(
						({ requestKey }) => requestKey === failed.requestKey,
					),
					`${failed.fault} must not repeat a generation`,
				).toHaveLength(1)
				if (
					failed.fault === 'download-failure' ||
					failed.fault === 'download-body-failure'
				)
					expect(
						relay.downloadAttempts.get(relay.admissions.indexOf(failed)),
					).toBe(2)
			}
			const ledger = reservations()
			expect(ledger).toHaveLength(relay.admissions.length)
			const pair = (tokens: number | null, images: number | null) =>
				JSON.stringify([tokens, images])
			for (let i = 1; i <= window; i++) {
				const run = `offline-${i}`
				const rows = ledger.filter(({ run_id }) => run_id === run)
				const csv = (await readFile(join(root, `usage-${i}.csv`), 'utf8'))
					.trimEnd()
					.split('\n')
				if (reviewDenial)
					expect(
						csv.filter((line) => line.split(',')[1] === 'review'),
					).toHaveLength(reviews.filter((row) => row.run === run).length)
				const logged = csv.map((line) => {
					const [, , , tokens, images] = line.split(',')
					return pair(
						tokens ? Number(tokens) : null,
						images ? Number(images) : null,
					)
				})
				expect(logged.sort()).toEqual(
					relay.admissions
						.filter((entry) => entry.run === run)
						.map(({ tokens, images }) => pair(tokens, images))
						.sort(),
				)
				expect(
					rows
						.map(({ actual_tokens, actual_images }) =>
							pair(actual_tokens, actual_images),
						)
						.sort(),
				).toEqual(logged)
				expect(
					rows.reduce((sum, row) => sum + (row.actual_tokens ?? row.tokens), 0),
				).toBeLessThanOrEqual(1_600_000)
				expect(
					rows.reduce((sum, row) => sum + (row.actual_images ?? row.images), 0),
				).toBeLessThanOrEqual(50)
				for (const row of rows) {
					expect(row.actual_tokens ?? 0).toBeLessThanOrEqual(2 * row.tokens)
					expect(row.actual_images ?? 0).toBeLessThanOrEqual(2 * row.images)
				}
			}
			if (name === 'clean') {
				console.info(
					'Synthetic settled production usage by chapter:',
					chapterIds.map((id, i) => {
						const rows = relay.admissions.filter(
							({ chapter, operation }) =>
								chapter === i + 1 && operation !== 'quality',
						)
						return {
							id,
							tokens: rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
							images: rows.reduce((sum, row) => sum + (row.images ?? 0), 0),
						}
					}),
				)
			}
		} finally {
			await host.close()
			vi.unstubAllEnvs()
			vi.unstubAllGlobals()
			await rm(root, { recursive: true, force: true })
		}
	},
	60_000,
)
