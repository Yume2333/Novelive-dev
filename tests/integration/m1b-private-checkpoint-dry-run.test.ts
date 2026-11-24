import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFiles } from '@novelive/format/model'
import { compileScript } from '@novelive/format/script'
import { expect, test, vi } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'
import { playbackAssetIds } from '../../packages/creator/src/pipeline/art/plan'
import { Project } from '../../packages/creator/src/project'
import { createProduction } from '../../packages/creator/src/project/production'
import { createReplayFetch } from '../../packages/creator/src/replay'
import { fakeRelay } from '../fixtures/m1b-offline-relay'

const {
	NL_M1B_DRY_RUN_CHECKPOINT: checkpoint,
	NL_M1B_DRY_RUN_PROFILE: profile,
	NL_M1B_DRY_RUN_RECORDINGS: recordings,
	NL_M1B_DRY_RUN_DRAWING_CHECKPOINT: drawingCheckpoint,
} = process.env

test.skipIf(!checkpoint || !profile)(
	'the private staging checkpoint reuses settled replies and publishes after a fresh offline admission',
	async () => {
		if (!checkpoint || !profile) return
		const root = await mkdtemp(
			join(tmpdir(), 'novelive-m1b-checkpoint-dry-run-'),
		)
		const directory = join(root, 'project')
		const relay = fakeRelay([], true)
		const recorded =
			recordings &&
			createReplayFetch({
				mode: 'strict',
				directory: recordings,
				normalizeIds: true,
			})
		let recordedAttempts = 0
		let probe = Boolean(recorded)
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const original = new Request(input, init)
			if (recorded && probe) {
				recordedAttempts++
				return recorded(original)
			}
			const url = new URL(original.url)
			return relay.fetch(
				new Request(`https://relay.invalid${url.pathname}`, original),
			)
		}
		const host = createProduction(
			root,
			createConfigStore(profile),
			{ fetch },
			() => {},
			() => {},
		)
		try {
			vi.stubGlobal('fetch', () => {
				throw new Error('Network is forbidden in the dry run')
			})
			vi.stubEnv('NL_REPLAY', '')
			vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
			vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '0.8')
			vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
			vi.stubEnv('NL_RUN_ID', 'offline-private-checkpoint')
			vi.stubEnv('NL_USAGE_CSV', join(root, 'usage.csv'))
			await cp(checkpoint, directory, { recursive: true })
			using project = await Project.open(directory)
			const series = await project.read(projectFiles.series)
			const [volumeId] = series.volumeIds
			const volume = await project.read(projectFiles.volume(volumeId))
			const [workId] = volume.workIds
			const work = await project.read(projectFiles.work(volumeId, workId))
			const [chapterId] = work.chapterIds
			const reservations = () =>
				project.database
					.prepare('SELECT * FROM spend_reservation ORDER BY id')
					.all()
			const original = reservations()
			expect(original).toHaveLength(102)
			await host.remember(workId, directory)
			const session = await host.get(workId)
			await session.queue.idle()
			expect(relay.admissions).toHaveLength(0)
			expect(session.snapshot().blockedChapterId).toBe(chapterId)
			expect(recordedAttempts).toBe(0)
			if (recorded) {
				await session.retry(chapterId)
				await session.queue.idle()
				expect(recordedAttempts).toBe(1)
				expect(session.snapshot().blockedChapterId).toBe(chapterId)
				expect(reservations()).toHaveLength(original.length + 1)
				expect(reservations().at(-1)).toMatchObject({ actual_tokens: null })
				probe = false
			}
			await session.retry(chapterId)
			await session.queue.idle()
			expect(session.snapshot().phase).toBe('confirm-first')
			expect(
				relay.admissions.filter(
					({ operation }) => operation === 'write' || operation === 'review',
				),
			).toHaveLength(0)
			expect(
				relay.admissions.filter(({ operation }) => operation === 'stage'),
			).toHaveLength(5)
			expect(
				relay.admissions.filter(
					({ operation, images }) => operation === 'image' && images,
				).length,
			).toBeLessThanOrEqual(11)
			expect(reservations().slice(0, original.length)).toEqual(original)
			const player = await host.player(workId, undefined, chapterId)
			const compiled = compileScript(player.script, {
				speakers: player.speakers,
				assets: player.registry.entries,
				customMarks: Object.keys(player.customMarks),
				paragraphIds: player.chapter.paragraphIds,
				sceneIds: player.chapter.sceneIds,
			})
			expect(compiled.ok).toBe(true)
			if (!compiled.ok) throw new Error('Private chapter did not compile')
			expect(compiled.scenes).toHaveLength(9)
			for (const id of playbackAssetIds(compiled.scenes)) {
				const asset = player.registry.entries.find((entry) => entry.id === id)
				expect(asset?.path).toMatch(/^player\/(?!unavailable\/)/)
				expect(
					(await readFile(join(root, 'cache', asset?.path ?? ''))).length,
				).toBeGreaterThan(0)
			}
		} finally {
			await host.close()
			vi.unstubAllEnvs()
			vi.unstubAllGlobals()
			await rm(root, { recursive: true, force: true })
		}
	},
	120_000,
)

test.skipIf(!drawingCheckpoint || !profile)(
	'the private drawing checkpoint resumes without staging requests',
	async () => {
		if (!drawingCheckpoint || !profile) return
		const root = await mkdtemp(join(tmpdir(), 'novelive-m1b-drawing-dry-run-'))
		const directory = join(root, 'project')
		const relay = fakeRelay([], true)
		const host = createProduction(
			root,
			createConfigStore(profile),
			{
				fetch: async (input, init) => {
					const request = new Request(input, init)
					const { pathname } = new URL(request.url)
					return relay.fetch(
						new Request(`https://relay.invalid${pathname}`, request),
					)
				},
			},
			() => {},
			() => {},
		)
		try {
			vi.stubGlobal('fetch', () => {
				throw new Error('Network is forbidden in the dry run')
			})
			vi.stubEnv('NL_REPLAY', '')
			vi.stubEnv('NL_RUN_TOKEN_CAP', '2000000')
			vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '0.8')
			vi.stubEnv('NL_RUN_IMAGE_CAP', '50')
			vi.stubEnv('NL_RUN_IMAGE_TOKEN_RESERVE', '7000')
			vi.stubEnv('NL_RUN_ID', 'offline-private-drawing')
			vi.stubEnv('NL_USAGE_CSV', join(root, 'usage.csv'))
			await cp(drawingCheckpoint, directory, { recursive: true })
			using project = await Project.open(directory)
			const series = await project.read(projectFiles.series)
			const [volumeId] = series.volumeIds
			const volume = await project.read(projectFiles.volume(volumeId))
			const [workId] = volume.workIds
			const reservations = () =>
				project.database
					.prepare('SELECT * FROM spend_reservation ORDER BY id')
					.all()
			const original = reservations()
			expect(original).toHaveLength(134)
			await host.remember(workId, directory)
			const session = await host.get(workId)
			await session.queue.idle()
			expect(relay.admissions).toHaveLength(0)
			expect(reservations()).toEqual(original)
			await session.continue()
			await session.queue.idle()
			expect(
				relay.admissions.some(({ operation }) => operation === 'image'),
			).toBe(true)
			expect(
				relay.admissions.filter(
					({ operation }) =>
						operation === 'stage' ||
						operation === 'write' ||
						operation === 'review',
				),
			).toHaveLength(0)
			const ledger = reservations()
			expect(ledger.slice(0, original.length)).toEqual(original)
			const images = ledger
				.slice(original.length)
				.filter(({ images }) => images !== 0)
			expect(images.length).toBeGreaterThan(0)
			for (const image of images)
				expect(image).toMatchObject({ tokens: 31_000, images: 3 })
		} finally {
			await host.close()
			vi.unstubAllEnvs()
			vi.unstubAllGlobals()
			await rm(root, { recursive: true, force: true })
		}
	},
	120_000,
)
