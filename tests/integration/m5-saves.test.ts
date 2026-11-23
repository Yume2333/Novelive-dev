import { createHash } from 'node:crypto'
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, test } from 'vitest'
import { FileProgressStore } from '../../apps/desktop/src/save-data'
import { workProgress } from '../../packages/creator/src/contract/player-progress'
import type {
	PlaybackBeat,
	SentenceRef,
	StageSnapshot,
	WorkProgress,
} from '../../packages/player/src/contract'
import { restoreSnapshot } from '../../packages/player/src/progress'
import {
	direct,
	emptyStage,
	stageAssets,
} from '../../packages/player/src/stage/state'

const directories: string[] = []
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	)
})

const workId = 'work'
const quick = { kind: 'quick' } as const
const manual = { kind: 'manual', slot: 1 } as const
const other = { kind: 'manual', slot: 2 } as const
const first = { chapterId: 'one', sceneId: 'scene-a', sentenceId: '0001' }
const removedSentence = { ...first, sentenceId: '0002' }
const removedChapter = {
	chapterId: 'old',
	sceneId: 'scene-b',
	sentenceId: '0001',
}
const otherChapter = { ...removedChapter, chapterId: 'new' }
const otherScene = { ...removedSentence, sceneId: 'scene-c' }

async function createStore() {
	const userData = await mkdtemp(join(tmpdir(), 'novelive-m5-saves-'))
	directories.push(userData)
	const directory = join(
		userData,
		'player-progress',
		createHash('sha256').update(workId).digest('hex'),
	)
	return { userData, directory, store: new FileProgressStore(userData) }
}

function snapshot(position: SentenceRef): StageSnapshot {
	return {
		position,
		stage: { ...emptyStage(), text: { kind: 'narration', content: [] } },
		active: [],
	}
}

function capture(background: string) {
	return sharp({ create: { width: 480, height: 270, channels: 4, background } })
		.png()
		.toBuffer()
}

function textBeat(
	position: SentenceRef,
	actions: PlaybackBeat['actions'] = [],
	text = snapshot(position).stage.text,
): PlaybackBeat {
	return {
		sceneId: position.sceneId,
		cue: { kind: 'text', position, text },
		actions,
		advance: { kind: 'click' },
	}
}

function spriteDirection(
	name: 'show' | 'face',
	id: string,
): PlaybackBeat['actions'][number] {
	return {
		type: 'action',
		line: 1,
		col: 1,
		name,
		args: { slot: 'left' },
		assets: [{ id, slot: 'left' }],
	}
}

test('restores every work’s progress and legacy saves when package publication fails', async () => {
	const { directory, store } = await createStore()
	const ids = [workId, 'another-work']
	for (const id of ids) {
		await store.saveSlot(id, quick, snapshot(first), await capture('#123456'))
		await store.saveSlot(
			id,
			manual,
			snapshot(removedChapter),
			await capture('#654321'),
		)
		await store.migrate({
			workId: id,
			fromVersion: 1,
			toVersion: 2,
			chapters: [[textBeat(first)]],
		})
	}
	const before = await Promise.all(
		ids.map(async (id) => ({
			progress: await store.load(id),
			legacy: await store.loadLegacySaves(id),
		})),
	)
	const original = await readFile(join(directory, 'progress.json'), 'utf8')
	await expect(
		store.migrateAndPublish(
			ids.map((id) => ({
				workId: id,
				fromVersion: 2,
				toVersion: 3,
				chapters: [[textBeat(otherChapter)]],
			})),
			async () => {
				const staged = await readFile(join(directory, 'progress.json'), 'utf8')
				expect(staged).not.toEqual(original)
				throw new Error('publish failed')
			},
		),
	).rejects.toThrow('publish failed')
	expect(
		await Promise.all(
			ids.map(async (id) => ({
				progress: await store.load(id),
				legacy: await store.loadLegacySaves(id),
			})),
		),
	).toEqual(before)
})

test('blocks writes for an unresolved migration until its backup is recovered', async () => {
	const { directory, store } = await createStore()
	const image = await capture('#123456')
	await store.saveSlot(workId, quick, snapshot(first), image)
	const before = await store.load(workId)
	const path = join(directory, 'progress.json')
	const staged = join(directory, 'staged-progress.json')
	await expect(
		store.migrateAndPublish(
			[
				{
					workId,
					fromVersion: 1,
					toVersion: 2,
					chapters: [[textBeat(otherChapter)]],
				},
			],
			async () => {
				await rename(path, staged)
				await mkdir(path)
				throw new Error('publish failed')
			},
		),
	).rejects.toThrow('Save migration rollback failed')
	await rm(path, { recursive: true })
	await rename(staged, path)
	await expect(
		store.save(workId, { mainline: first, read: [], saves: [] }),
	).rejects.toThrow('Restart Novelive')
	await expect(
		store.saveSlot(workId, quick, snapshot(otherChapter), image),
	).rejects.toThrow('Restart Novelive')
	await expect(store.deleteLegacySave(workId, 1, quick)).rejects.toThrow(
		'Restart Novelive',
	)
	await expect(
		store.save('other-work', { mainline: null, read: [], saves: [] }),
	).resolves.toBeUndefined()
	await store.recoverPackageMigration(
		(id, version) => id === workId && version === 1,
	)
	expect(await store.load(workId)).toEqual(before)
	await expect(
		store.saveSlot(workId, quick, snapshot(otherChapter), image),
	).resolves.toBeDefined()
})

test.each([false, true])(
	'recovers an interrupted migration (library published: %s)',
	async (published) => {
		const { userData, store } = await createStore()
		await store.saveSlot(
			workId,
			quick,
			snapshot(first),
			await capture('#123456'),
		)
		const before = await store.load(workId)
		const staged = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const migration = store.migrateAndPublish(
			[
				{
					workId,
					fromVersion: 1,
					toVersion: 2,
					chapters: [[textBeat(otherChapter)]],
				},
			],
			async () => {
				staged.resolve()
				await release.promise
			},
		)
		try {
			await Promise.race([staged.promise, migration])
			const restarted = new FileProgressStore(userData)
			expect((await restarted.load(workId))?.saves).toEqual([])
			const hasVersion = (id: string, version: number) =>
				id === workId && version === (published ? 2 : 1)
			await restarted.recoverPackageMigration(hasVersion)
			expect(await restarted.load(workId)).toEqual(
				published ? { ...before, saves: [] } : before,
			)
			expect(await restarted.loadLegacySaves(workId)).toMatchObject(
				published ? [{ version: 1 }] : [],
			)
			await restarted.recoverPackageMigration(hasVersion)
		} finally {
			release.resolve()
			await migration
		}
	},
)

test('restores the new release sprite in time for its next expression change', async () => {
	const { store } = await createStore()
	const saved = snapshot(first)
	saved.stage.sprites = direct(
		saved.stage,
		spriteDirection('show', 'hero/old/calm'),
	).sprites
	await store.saveSlot(workId, quick, saved, await capture('#123456'))

	const next = spriteDirection('face', 'hero/new/smiling')
	const update = {
		workId,
		fromVersion: 1,
		toVersion: 2,
		chapters: [
			[
				textBeat(removedSentence, [spriteDirection('show', 'hero/new/calm')]),
				textBeat(first),
				textBeat({ ...first, sentenceId: '0003' }, [next]),
			],
		],
	}
	const { progress } = await store.migrate(update)
	const [retained] = progress.saves
	expect(retained.snapshot.stage.sprites.left?.assetId).toBe('hero/new/calm')
	expect(direct(retained.snapshot.stage, next).sprites.left?.assetId).toBe(
		'hero/new/smiling',
	)
})

test('restores a kept sentence after the new release removes its saved background', async () => {
	const { store } = await createStore()
	const saved = snapshot(first)
	saved.stage.background = { assetId: 'old/room', transition: null }
	saved.stage.cg = 'kept/cg'
	saved.active = [
		{
			restore: 'replay-state',
			action: {
				type: 'action',
				line: 1,
				col: 1,
				name: 'bg',
				args: {},
				assets: [{ id: 'old/room' }],
			},
		},
	]
	await store.saveSlot(workId, quick, saved, await capture('#123456'))
	const updatedText = {
		kind: 'narration',
		content: [{ type: 'text', text: 'Revised' }],
	} as const
	const cg = {
		type: 'action',
		line: 1,
		col: 1,
		name: 'cg',
		args: {},
		assets: [{ id: 'kept/cg' }],
	} as const satisfies PlaybackBeat['actions'][number]
	const update = {
		workId,
		fromVersion: 1,
		toVersion: 2,
		chapters: [[textBeat(first, [cg], updatedText)]],
	}
	const { progress, legacySaves } = await store.migrate(update)
	const [retained] = progress.saves
	expect(retained.snapshot.position).toEqual(first)
	expect(legacySaves).toEqual([])

	let state = emptyStage()
	const setState = (next: typeof state) => {
		for (const asset of stageAssets(next))
			if (asset !== 'kept/cg') throw new Error(`Missing asset: ${asset}`)
		state = next
	}
	await restoreSnapshot(retained.snapshot, {
		setState,
		replayState: (action) => setState(direct(state, action)),
		restartText: () => {},
	})
	expect(state).toEqual({ ...saved.stage, background: null, text: updatedText })
})

test('updates an existing progress file by full ID and persists archived slots with their thumbnails', async () => {
	const { userData, directory, store } = await createStore()
	const sharedCapture = await capture('#123456')
	const removedCapture = await capture('#abcdef')
	const retained = await store.saveSlot(
		workId,
		quick,
		snapshot(first),
		sharedCapture,
	)
	const missingSentence = await store.saveSlot(
		workId,
		manual,
		snapshot(removedSentence),
		sharedCapture,
	)
	const missingChapter = await store.saveSlot(
		workId,
		other,
		snapshot(removedChapter),
		removedCapture,
	)

	const text: StageSnapshot['stage']['text'] = {
		kind: 'dialogue',
		content: [{ type: 'text', text: 'Hello' }],
	}
	const path = join(directory, 'progress.json')
	const oldFile = {
		mainline: removedSentence,
		read: [first, removedSentence, removedChapter],
		saves: [
			{
				...retained,
				snapshot: {
					position: first,
					stage: {
						background: { assetId: 'room' },
						camera: { zoom: { scale: 1.5 } },
						text,
					},
				},
			},
			missingSentence,
			missingChapter,
		],
	}
	await writeFile(path, JSON.stringify(oldFile))
	const orphan = join(directory, 'unreferenced.webp')
	await writeFile(orphan, 'orphan')

	const migrating = new FileProgressStore(userData)
	const update = {
		workId,
		fromVersion: 1,
		toVersion: 2,
		chapters: [
			[textBeat(otherChapter)],
			[
				textBeat(otherScene),
				textBeat(
					first,
					[
						{
							type: 'action',
							line: 1,
							col: 1,
							name: 'bg',
							args: { transition: 'none' },
							assets: [{ id: 'room' }],
						},
						{
							type: 'action',
							line: 2,
							col: 1,
							name: 'zoom',
							args: { scale: 1.5, target: 'stage' },
							assets: [],
						},
					],
					text,
				),
			],
		] satisfies readonly (readonly PlaybackBeat[])[],
	}
	const expected: WorkProgress = {
		mainline: otherScene,
		read: [first],
		saves: [
			{
				...retained,
				snapshot: {
					...snapshot(first),
					active: [{ restore: 'restart-text' }],
					stage: {
						...emptyStage(),
						background: { assetId: 'room', transition: null },
						camera: {
							...emptyStage().camera,
							zoom: { scale: 1.5, target: 'stage' },
						},
						text,
					},
				},
			},
		],
	}
	const legacySaves = [{ version: 1, saves: [missingSentence, missingChapter] }]
	expect(await migrating.migrate(update)).toEqual({
		progress: expected,
		legacySaves,
	})
	expect(await migrating.migrate(update)).toEqual({
		progress: expected,
		legacySaves,
	})

	const reopened = new FileProgressStore(userData)
	expect(await reopened.load(workId)).toEqual(expected)
	expect(workProgress.check(await reopened.load(workId))).toBe(true)
	expect(await reopened.loadLegacySaves(workId)).toEqual(legacySaves)
	await reopened.save(workId, { ...expected, read: [first, otherScene] })
	const current = await reopened.saveSlot(
		workId,
		quick,
		snapshot(otherScene),
		sharedCapture,
	)
	expect(await reopened.loadLegacySaves(workId)).toEqual(legacySaves)
	expect(current.thumbnailRef).toBe(missingSentence.thumbnailRef)
	expect(await reopened.thumbnail(workId, missingSentence)).toBeInstanceOf(
		Buffer,
	)
	expect(await reopened.thumbnail(workId, missingChapter)).toBeInstanceOf(
		Buffer,
	)
	await expect(readFile(orphan)).rejects.toMatchObject({ code: 'ENOENT' })

	await reopened.deleteLegacySave(workId, 1, manual)
	expect(await reopened.thumbnail(workId, current)).toBeInstanceOf(Buffer)
	expect(await reopened.loadLegacySaves(workId)).toEqual([
		{ version: 1, saves: [missingChapter] },
	])
	await reopened.deleteLegacySave(workId, 1, other)
	const afterDeletion = new FileProgressStore(userData)
	expect(await afterDeletion.loadLegacySaves(workId)).toEqual([])
	await expect(
		afterDeletion.thumbnail(workId, missingChapter),
	).rejects.toMatchObject({ code: 'ENOENT' })
	expect(await afterDeletion.load(workId)).toEqual({
		mainline: otherScene,
		read: [first, otherScene],
		saves: [current],
	})
})

test('keeps identical slot numbers independent across releases and bounds the mainline to existing positions', async () => {
	const { store } = await createStore()
	const image = await capture('#123456')
	const oldest = await store.saveSlot(
		workId,
		quick,
		snapshot(removedChapter),
		image,
	)
	await store.save(workId, {
		mainline: removedChapter,
		read: [removedChapter],
		saves: [oldest],
	})
	const update = {
		workId,
		fromVersion: 1,
		toVersion: 2,
		chapters: [[textBeat(first)], [textBeat(otherChapter)]],
	}
	expect(
		(await store.migrate({ ...update, toVersion: 1 })).progress.mainline,
	).toEqual(removedChapter)
	expect((await store.migrate(update)).progress.mainline).toEqual(first)

	const newer = await store.saveSlot(workId, quick, snapshot(first), image)
	const release = await store.migrate({
		...update,
		fromVersion: 2,
		toVersion: 3,
		chapters: [],
	})
	expect(release).toEqual({
		progress: { mainline: null, read: [], saves: [] },
		legacySaves: [
			{ version: 1, saves: [oldest] },
			{ version: 2, saves: [newer] },
		],
	})
	await store.deleteLegacySave(workId, 1, quick)
	expect(await store.loadLegacySaves(workId)).toEqual([
		{ version: 2, saves: [newer] },
	])
	expect(await store.thumbnail(workId, newer)).toBeInstanceOf(Buffer)
})
