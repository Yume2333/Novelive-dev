import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { FileProgressStore } from '../../apps/desktop/src/save-data'
import type {
	SentenceRef,
	StageSnapshot,
} from '../../packages/player/src/contract'
import {
	captureSnapshot,
	PlaybackProgress,
	restoreSnapshot,
	slotKey,
} from '../../packages/player/src/progress'

const directories: string[] = []
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	)
})

async function store() {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-save-'))
	directories.push(directory)
	return { directory, saves: new FileProgressStore(directory) }
}

function snapshot(index: number): StageSnapshot {
	return {
		position: {
			chapterId: `chapter-${Math.floor(index / 100)}`,
			sceneId: 'scene',
			sentenceId: String(index),
		},
		stage: {
			background: {
				assetId: 'room/night',
				transition: {
					fromAssetId: 'room/day',
					name: 'fade',
					durationSeconds: 1,
				},
			},
			sprites: {
				left: {
					assetId: 'hero/coat/calm',
					position: 'left',
					transform: { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
					layer: 2,
				},
			},
			cg: 'cg',
			foreground: 'foreground',
			camera: {
				motion: 'push-in',
				zoom: { scale: 1.2, target: 'left' },
				shake: { strength: 0.3 },
			},
			particle: { effect: 'rain', intensity: 0.3, speed: 1, angle: 0 },
			mask: { shape: 'vignette', strength: 0.5 },
			filter: { effect: 'sepia', value: 0.4 },
			text: {
				kind: 'dialogue',
				speaker: 'hero',
				displayName: '旅人',
				content: [{ type: 'text', text: '你好' }],
			},
		},
		active: [
			{
				restore: 'replay-state',
				action: {
					type: 'action',
					line: 1,
					col: 1,
					name: 'bg',
					args: { asset: 'room/night', transition: 'fade', duration: 1 },
					assets: [{ id: 'room/night' }],
				},
			},
			{ restore: 'restart-text' },
			{ restore: 'skip-relative' },
		],
	}
}

const compare = (a: SentenceRef, b: SentenceRef) =>
	Number(a.sentenceId) - Number(b.sentenceId)

test('empty history and slots are empty, invalid moves and slots are rejected', async () => {
	const { saves } = await store()
	expect(await saves.load('work')).toBeNull()
	const progress = new PlaybackProgress(compare)
	expect(progress.rollback()).toBeNull()
	expect(progress.forward()).toBeNull()
	expect(progress.jump(Number.NaN)).toBeNull()
	expect(progress.loadSave({ kind: 'quick' })).toBeNull()
	for (const slot of [0, 61, -1, 1.5, Number.NaN])
		expect(() => slotKey({ kind: 'manual', slot })).toThrow(RangeError)
})

test('retains 200 snapshots, rolls across chapters, forwards and branches without mutating snapshots', () => {
	const progress = new PlaybackProgress(compare)
	for (let i = 0; i < 205; i++) progress.record(snapshot(i))
	expect(progress.history.entries).toHaveLength(200)
	expect(progress.history.entries[0].position.sentenceId).toBe('5')
	expect(progress.jump(94)?.position.sentenceId).toBe('99')
	expect(progress.forward()?.position.chapterId).toBe('chapter-1')
	expect(progress.rollback()?.position.chapterId).toBe('chapter-0')
	expect(progress.data.mainline?.sentenceId).toBe('204')
	const copy = progress.history
	copy.entries[0].stage.cg = 'changed'
	expect(progress.history.entries[0].stage.cg).toBe('cg')
	progress.record(snapshot(99))
	expect(progress.forward()).toBeNull()
	expect(progress.history.entries).toHaveLength(96)
	expect(progress.data.mainline?.sentenceId).toBe('204')
	expect(progress.isRead(snapshot(204).position)).toBe(true)
	expect(
		progress.isRead({
			sentenceId: '204',
			sceneId: 'scene',
			chapterId: 'chapter-2',
		}),
	).toBe(true)
})

test('reread records read sentences without moving mainline, which advances only in main mode', () => {
	const progress = new PlaybackProgress(compare)
	progress.record(snapshot(100))
	expect(progress.openChapter('chapter-1')).toBe('reread')
	progress.record(snapshot(150))
	expect(progress.isRead(snapshot(150).position)).toBe(true)
	expect(progress.data.mainline).toEqual(snapshot(100).position)
	expect(progress.openChapter('chapter-2')).toBe('main')
	progress.record(snapshot(200))
	expect(progress.data.mainline).toEqual(snapshot(200).position)
})

test('reopens application-data progress, 60 manual + 1 quick slots, WebP thumbnails and unfinished performances', async () => {
	const { directory, saves } = await store()
	const progress = new PlaybackProgress(compare)
	progress.record(snapshot(100))
	await saves.save('work', progress.data)
	const capture = await sharp({
		create: { width: 960, height: 540, channels: 4, background: '#234567' },
	})
		.png()
		.toBuffer()
	const first = snapshot(20)
	const frozen = captureSnapshot(first.position, first.stage, first.active)
	first.stage.cg = 'modified'
	for (let slot = 1; slot <= 60; slot++)
		await saves.saveSlot('work', { kind: 'manual', slot }, frozen, capture)
	await saves.saveSlot('work', { kind: 'quick' }, frozen, capture)
	await saves.saveSlot('work', { kind: 'quick' }, snapshot(30), capture)
	await Promise.all([
		saves.saveSlot('work', { kind: 'manual', slot: 59 }, frozen, capture),
		saves.saveSlot('work', { kind: 'manual', slot: 60 }, frozen, capture),
	])
	const reopened = new FileProgressStore(directory)
	const data = await reopened.load('work')
	expect(data?.saves).toHaveLength(61)
	expect(data?.mainline).toEqual(snapshot(100).position)
	expect(data?.read).toEqual([snapshot(100).position])
	expect(await reopened.load('other-work')).toBeNull()
	if (!data) throw new Error('Missing saved progress')
	const entry = data.saves[0]
	expect(entry.snapshot).toEqual(frozen)
	expect(
		await sharp(await reopened.thumbnail('work', entry)).metadata(),
	).toMatchObject({ format: 'webp', width: 480, height: 270 })
	const restored = new PlaybackProgress(compare, data)
	expect(restored.loadSave({ kind: 'manual', slot: 1 })).toEqual(frozen)
	expect(restored.data.mainline).toEqual(snapshot(100).position)
	const renderer = {
		setState: vi.fn(),
		replayState: vi.fn(),
		restartText: vi.fn(),
	}
	await restoreSnapshot(frozen, renderer)
	expect(renderer.setState).toHaveBeenCalledWith(frozen.stage)
	expect(renderer.replayState.mock.calls).toEqual([
		[frozen.active[0].restore === 'replay-state' && frozen.active[0].action],
	])
	expect(renderer.restartText).toHaveBeenCalledExactlyOnceWith(
		frozen.stage.text,
		0,
	)
	expect(restored.loadSave({ kind: 'quick' })?.position).toEqual(
		snapshot(30).position,
	)
	const replacement = { ...entry, snapshot: snapshot(50) }
	restored.putSave(replacement)
	replacement.snapshot.stage.cg = 'mutated'
	expect(restored.data.saves).toHaveLength(61)
	expect(restored.loadSave(entry.slot)?.stage.cg).toBe('cg')
	expect(restored.history.entries).toHaveLength(1)
})

test('restore errors propagate and empty active lists still restart only the text', async () => {
	const saved = { ...snapshot(0), active: [] }
	const renderer = {
		setState: vi.fn(),
		replayState: vi.fn(),
		restartText: vi.fn(),
	}
	await restoreSnapshot(saved, renderer)
	expect(renderer.replayState).not.toHaveBeenCalled()
	expect(renderer.restartText).toHaveBeenCalledExactlyOnceWith(
		saved.stage.text,
		0,
	)
	renderer.setState.mockRejectedValueOnce(new Error('renderer failed'))
	await expect(restoreSnapshot(saved, renderer)).rejects.toThrow(
		'renderer failed',
	)
})

test('failed image saves preserve existing data, malformed data propagates, and work IDs cannot escape app data', async () => {
	const { directory, saves } = await store()
	const progress = new PlaybackProgress(compare)
	progress.record(snapshot(1))
	await saves.save('../../outside', progress.data)
	await expect(
		saves.saveSlot(
			'../../outside',
			{ kind: 'quick' },
			snapshot(1),
			new Uint8Array(),
		),
	).rejects.toThrow()
	expect(await saves.load('../../outside')).toEqual(progress.data)
	await expect(
		saves.thumbnail('work', {
			slot: { kind: 'quick' },
			savedAt: '',
			snapshot: snapshot(1),
			thumbnailRef: '../../secret',
		}),
	).rejects.toThrow('无效')
	const { createHash } = await import('node:crypto')
	const path = join(
		directory,
		'player-progress',
		createHash('sha256').update('../../outside').digest('hex'),
		'progress.json',
	)
	expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(progress.data)
	await writeFile(path, '{broken')
	await expect(saves.load('../../outside')).rejects.toThrow(SyntaxError)
})
