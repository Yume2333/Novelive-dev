import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { playerProgressRequest } from '../../packages/creator/src/contract/player-progress'
import { Project } from '../../packages/creator/src/project'
import { listLibrary } from '../../packages/creator/src/project/library'
import {
	loadPlayerChapter,
	loadPlayerStatus,
} from '../../packages/creator/src/project/player'
import { projectFiles } from '../../packages/format/src/model'
import { type Beat, compileScript } from '../../packages/format/src/script'
import { createPlayback } from '../../packages/player/src/minimal/playback'
import {
	containsSentence,
	restoredChapterMode,
} from '../../packages/ui/src/pages/player/controls/position'
import {
	playerRef,
	playerScript,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'
import { context } from '../fixtures/script/context'

const directories: string[] = []

test('restoring history selects main mode for the mainline and unread chapters', () => {
	const first = { chapterId: 'ch1', sceneId: 'scene', sentenceId: 'line' }
	const second = { ...first, chapterId: 'ch2' }
	const progress = { mainline: second, read: [first, second], saves: [] }
	expect(restoredChapterMode(progress, 'ch1')).toBe('reread')
	expect(restoredChapterMode(progress, 'ch2')).toBe('main')
	expect(restoredChapterMode(progress, 'ch3')).toBe('main')
	expect(
		restoredChapterMode({ mainline: null, read: [], saves: [] }, 'ch1'),
	).toBe('main')
})

test('persisted resume positions are checked against the current chapter', () => {
	const result = compileScript('scene 空屋\nsource p0001\n: 开始。', {
		...context,
		paragraphIds: ['p0001'],
		sceneIds: ['aaaabbbb'],
	})
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	const scene = result.scenes[0]
	const position = {
		chapterId: 'ch1',
		sceneId: scene.scene.id ?? '',
		sentenceId: scene.beats[0].line?.id ?? '',
	}
	expect(containsSentence(result.scenes, position)).toBe(true)
	expect(
		containsSentence(result.scenes, { ...position, sentenceId: 'removed' }),
	).toBe(false)
	expect(
		containsSentence(result.scenes, { ...position, sceneId: 'rewritten' }),
	).toBe(false)
	expect(containsSentence([], position)).toBe(false)
})

test('desktop progress IPC validates empty progress, slots, snapshots and capture bounds', () => {
	const snapshot = {
		position: { chapterId: 'ch1', sceneId: 'aaaabbbb', sentenceId: '0001' },
		stage: {
			background: null,
			sprites: {},
			cg: null,
			foreground: null,
			camera: {
				motion: 'reset',
				zoom: { scale: 1, target: 'stage' },
				shake: null,
			},
			particle: null,
			mask: null,
			filter: null,
			text: { kind: 'narration', content: [{ type: 'text', text: '开始' }] },
		},
		active: [],
	}
	const capture = {
		operation: 'saveSlot',
		workId: playerWorkId,
		slot: { kind: 'quick' },
		snapshot,
		rect: { x: 0, y: 0, width: 480, height: 270 },
	}
	expect(playerProgressRequest.check(capture)).toBe(true)
	expect(
		playerProgressRequest.check({
			...capture,
			rect: { ...capture.rect, x: -1 },
		}),
	).toBe(false)
	expect(
		playerProgressRequest.check({
			...capture,
			rect: { ...capture.rect, width: 0 },
		}),
	).toBe(false)
	expect(
		playerProgressRequest.check({
			...capture,
			snapshot: { ...snapshot, active: [{ restore: 'unknown' }] },
		}),
	).toBe(false)
	expect(
		playerProgressRequest.check({ operation: 'load', workId: playerWorkId }),
	).toBe(true)
	expect(
		playerProgressRequest.check({
			operation: 'save',
			workId: playerWorkId,
			progress: { mainline: null, read: [], saves: [] },
		}),
	).toBe(true)
	expect(
		playerProgressRequest.check({
			operation: 'thumbnail',
			workId: playerWorkId,
			slot: { kind: 'manual', slot: 60 },
		}),
	).toBe(true)
	for (const input of [
		null,
		{ operation: 'load', workId: '' },
		{
			operation: 'thumbnail',
			workId: playerWorkId,
			slot: { kind: 'manual', slot: 61 },
		},
		{
			operation: 'save',
			workId: playerWorkId,
			progress: { mainline: null, read: [{}], saves: [] },
		},
		{
			operation: 'saveSlot',
			workId: playerWorkId,
			slot: { kind: 'quick' },
			snapshot: {},
			rect: { x: -1, y: 0, width: 480, height: 270 },
		},
	])
		expect(playerProgressRequest.check(input)).toBe(false)
})

test('library counts the same published chapters as the player with and without scheduler rows', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'novelive-library-publication-'),
	)
	directories.push(directory)
	const root = join(directory, 'project')
	await seedPlayerProject(
		root,
		Buffer.from('background'),
		Buffer.from('portrait'),
	)
	await mkdir(join(directory, 'projects'))
	await writeFile(join(directory, 'projects', playerWorkId), root)
	using project = await Project.open(root)
	const chapter = await project.read(projectFiles.chapter(playerRef))
	const work = projectFiles.work('v1', playerWorkId)
	await project.write(work, {
		...(await project.read(work)),
		chapterIds: ['ch1', 'ch2', 'ch3'],
	})
	for (const [chapterId, sceneIds] of [
		['ch2', chapter.sceneIds],
		['ch3', []],
	] as const)
		await project.write(projectFiles.chapter({ ...playerRef, chapterId }), {
			...chapter,
			chapterId,
			sceneIds: [...sceneIds],
		})
	async function expectPublication(expected: boolean[]) {
		const player = await loadPlayerStatus(root, playerWorkId)
		expect(player.chapters.map(({ published }) => published)).toEqual(expected)
		expect(await listLibrary(directory)).toEqual({
			works: [
				{
					workId: playerWorkId,
					title: '黄昏',
					published: expected.filter(Boolean).length,
					chapters: 3,
					project: {
						directory: root,
						seriesId: 'minimal',
						seriesTitle: '合成播放器工程',
						volumeId: 'v1',
						volumeTitle: '卷一',
						volumeIndex: 1,
					},
				},
			],
			unreadableCount: 0,
		})
	}
	await expectPublication([true, true, false])
	project.database
		.prepare(
			"INSERT INTO work (work_id, title, queue_pos, created_at) VALUES (?, '测试', 0, 0)",
		)
		.run(playerWorkId)
	project.database
		.prepare(
			"INSERT INTO chapter (work_id, chapter_id, ord, user_state) VALUES (?, 'ch1', 1, 'waiting'), (?, 'ch3', 3, 'published')",
		)
		.run(playerWorkId, playerWorkId)
	await expectPublication([false, false, true])
})

test('player chapter selection defaults to first and only admits published production chapters', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-chapter-selection-'))
	directories.push(directory)
	const root = join(directory, 'project')
	const cache = join(directory, 'cache')
	await seedPlayerProject(
		root,
		Buffer.from('background'),
		Buffer.from('portrait'),
	)
	{
		using project = await Project.open(root)
		const file = projectFiles.work('v1', playerWorkId)
		await project.write(file, {
			...(await project.read(file)),
			chapterIds: ['ch1', 'ch2'],
		})
		await project.write(
			projectFiles.chapter({ ...playerRef, chapterId: 'ch2' }),
			{
				...(await project.read(projectFiles.chapter(playerRef))),
				chapterId: 'ch2',
				title: '第二章',
			},
		)
		await project.writeFile(
			projectFiles.scene({ ...playerRef, chapterId: 'ch2' }, 'aaaabbbb'),
			playerScript,
		)
		project.database
			.prepare(
				'INSERT INTO work (work_id, title, queue_pos, created_at) VALUES (?, ?, 0, 0)',
			)
			.run(playerWorkId, '测试')
		project.database
			.prepare(
				"INSERT INTO chapter (work_id, chapter_id, ord, user_state) VALUES (?, 'ch1', 1, 'published'), (?, 'ch2', 2, 'producing')",
			)
			.run(playerWorkId, playerWorkId)
		project.database
			.prepare(
				"INSERT INTO task (task_id, work_id, kind, ref_id, seq, created_at, phase) VALUES ('next-chapter', ?, 'chapter', 'ch2', 1, 0, 'review')",
			)
			.run(playerWorkId)
	}
	const first = await loadPlayerChapter(root, playerWorkId, cache)
	expect(first.chapter.chapterId).toBe('ch1')
	expect(first.chapters).toEqual([
		{ chapterId: 'ch1', title: '空屋', published: true, progress: '已发布' },
		{
			chapterId: 'ch2',
			title: '第二章',
			published: false,
			progress: '制作中 · 审稿',
		},
	])
	await expect(
		loadPlayerChapter(root, playerWorkId, cache, 'ch2'),
	).rejects.toMatchObject({ code: 'not_found' })
	await expect(
		loadPlayerChapter(root, playerWorkId, cache, 'missing'),
	).rejects.toMatchObject({ code: 'not_found' })
	{
		using project = await Project.open(root)
		project.database
			.prepare(
				"UPDATE chapter SET user_state = 'published' WHERE chapter_id = 'ch2'",
			)
			.run()
	}
	expect(
		(await loadPlayerChapter(root, playerWorkId, cache, 'ch2')).chapter
			.chapterId,
	).toBe('ch2')
	{
		using project = await Project.open(root)
		project.database
			.prepare(
				"UPDATE chapter SET user_state = 'waiting' WHERE chapter_id = 'ch1'",
			)
			.run()
	}
	await expect(
		loadPlayerChapter(root, playerWorkId, cache),
	).rejects.toMatchObject({ code: 'not_found' })
	{
		using project = await Project.open(root)
		await project.writeFile(
			projectFiles.assetRegistry({ level: 'series' }).path,
			'{',
		)
	}
	expect(
		(await loadPlayerStatus(root, playerWorkId)).chapters.map(
			({ published }) => published,
		),
	).toEqual([false, true])
	await expect(loadPlayerStatus(root, 'missing')).rejects.toMatchObject({
		code: 'not_found',
	})
	await expect(
		loadPlayerChapter(root, playerWorkId, cache, 'ch2'),
	).rejects.toThrow()
})
afterEach(async () => {
	vi.useRealTimers()
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	)
})

test('plays compiled beats in order across scenes including click, auto, delay and trailing actions', async () => {
	vi.useFakeTimers()
	const result = compileScript(
		'scene 一\nsource p0001\n: 开始\n@wait 0.2\n\nscene 二\nsource p0002\n@caption 后来 wait\n@bg room/dusk\n',
		context,
	)
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	const render = vi.fn(async (_beat: Beat | undefined) => {})
	const onError = vi.fn()
	const playback = createPlayback(
		result.scenes,
		render,
		new AbortController().signal,
		onError,
	)
	await playback.start()
	expect(render).toHaveBeenCalledTimes(1)
	playback.click()
	await vi.advanceTimersByTimeAsync(199)
	expect(render).toHaveBeenCalledTimes(2)
	playback.click()
	await vi.advanceTimersByTimeAsync(1)
	expect(render).toHaveBeenCalledTimes(3)
	playback.click()
	await vi.runAllTimersAsync()
	expect(render.mock.calls.map(([beat]) => beat)).toEqual([
		...result.scenes.flatMap((scene) => scene.beats),
		undefined,
	])
	playback.click()
	expect(render).toHaveBeenCalledTimes(5)
	expect(onError).not.toHaveBeenCalled()
})

test('restored start options keep the fifth text-finished hook, including failure and abort', async () => {
	vi.useFakeTimers()
	const result = compileScript(
		'scene 一\nsource p0001\n: 已过\n: 自动 cont\n: 结束\n',
		{ ...context, paragraphIds: ['p0001'] },
	)
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	const beats = result.scenes.flatMap((scene) => scene.beats)
	const render = vi.fn(async (_beat: Beat | undefined) => {})
	const onError = vi.fn()
	let finish = () => {}
	const textFinished = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve
			}),
	)
	const controller = new AbortController()
	const playback = createPlayback(
		result.scenes,
		render,
		controller.signal,
		onError,
		textFinished,
		{ startIndex: 1 },
	)
	const starting = playback.start()
	await vi.advanceTimersByTimeAsync(0)
	expect(render).toHaveBeenCalledExactlyOnceWith(beats[1])
	expect(textFinished).toHaveBeenCalledTimes(1)
	playback.click()
	finish()
	await starting
	await vi.advanceTimersByTimeAsync(0)
	expect(render.mock.calls.map(([beat]) => beat)).toEqual([beats[1], beats[2]])
	controller.abort()
	const failure = new Error('text unavailable')
	const broken = createPlayback(
		result.scenes,
		render,
		new AbortController().signal,
		onError,
		async () => {
			throw failure
		},
		{ startIndex: 1 },
	)
	await broken.start()
	expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
	render.mockClear()
	const abort = new AbortController()
	const waiting = createPlayback(
		result.scenes,
		render,
		abort.signal,
		onError,
		textFinished,
		{ startIndex: 1 },
	)
	const pending = waiting.start()
	await vi.advanceTimersByTimeAsync(0)
	abort.abort()
	finish()
	await pending
	await vi.runAllTimersAsync()
	expect(render).toHaveBeenCalledExactlyOnceWith(beats[1])
})

test('empty playback ends once; rendering errors stop playback and abort cancels timers', async () => {
	vi.useFakeTimers()
	const render = vi.fn(async (_beat: Beat | undefined) => {})
	const onError = vi.fn()
	const controller = new AbortController()
	const empty = createPlayback([], render, controller.signal, onError)
	await empty.start()
	await empty.start()
	expect(render).toHaveBeenCalledExactlyOnceWith(undefined)
	const result = compileScript('scene 一\nsource p0001\n@wait 1\n: 结束\n', {
		...context,
		paragraphIds: ['p0001'],
	})
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	const failure = new Error('asset unavailable')
	const broken = createPlayback(
		result.scenes,
		async () => {
			throw failure
		},
		controller.signal,
		onError,
	)
	await broken.start()
	await broken.start()
	expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
	render.mockClear()
	const timed = createPlayback(
		result.scenes,
		render,
		controller.signal,
		onError,
	)
	await timed.start()
	controller.abort()
	await vi.runAllTimersAsync()
	expect(render).toHaveBeenCalledTimes(1)
})

test('clicks during an asynchronous render cannot skip a beat', async () => {
	const result = compileScript('scene 一\nsource p0001\n: 一\n: 二\n', {
		...context,
		paragraphIds: ['p0001'],
	})
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	let release: () => void = () => {}
	const render = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				release = resolve
			}),
	)
	const playback = createPlayback(
		result.scenes,
		render,
		new AbortController().signal,
		vi.fn(),
	)
	const starting = playback.start()
	playback.click()
	playback.click()
	expect(render).toHaveBeenCalledTimes(1)
	release()
	await starting
	playback.click()
	expect(render).toHaveBeenCalledTimes(2)
	release()
})

test('loads a local chapter with merged registry, resolves cache bytes and rejects absent works, empty chapters and unsafe assets', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-player-unit-'))
	directories.push(directory)
	const root = join(directory, 'project')
	const cache = join(directory, 'cache')
	await seedPlayerProject(
		root,
		Buffer.from('background'),
		Buffer.from('portrait'),
	)
	const result = await loadPlayerChapter(root, playerWorkId, cache)
	expect(result.script).toBe(playerScript)
	expect(result.chapter.sceneIds).toEqual(['aaaabbbb'])
	const room = result.registry.entries.find((entry) => entry.id === 'room/dusk')
	if (!room) throw new Error('Missing fixture background')
	expect(result.speakers).toEqual(['traveler', 'listener', 'witness'])
	expect(result.speakerNames).toEqual({
		traveler: '旅人',
		listener: '听者',
		witness: '见证者',
	})
	expect(
		result.registry.entries.some((entry) => entry.id.startsWith('listener/')),
	).toBe(false)
	const compiled = compileScript(result.script, {
		paragraphIds: result.chapter.paragraphIds,
		sceneIds: result.chapter.sceneIds,
		assets: result.registry.entries,
		speakers: result.speakers,
		customMarks: Object.keys(result.customMarks),
	})
	expect(result.customMarks).toEqual({
		wave: { css: 'color: red', perChar: false },
	})
	expect(
		compileScript(result.script, {
			paragraphIds: result.chapter.paragraphIds,
			sceneIds: result.chapter.sceneIds,
			assets: result.registry.entries,
			speakers: result.speakers,
		}).diagnostics,
	).toEqual(
		expect.arrayContaining([expect.objectContaining({ code: 'E_TAG' })]),
	)
	expect(compiled.ok).toBe(true)
	if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
	expect(compiled.scenes[0].beats[1].line).toMatchObject({
		kind: 'inner',
		speaker: 'listener',
	})
	expect(
		compileScript(result.script, {
			paragraphIds: result.chapter.paragraphIds,
			assets: result.registry.entries,
			speakers: ['traveler'],
			customMarks: Object.keys(result.customMarks),
		}).diagnostics,
	).toEqual(
		expect.arrayContaining([expect.objectContaining({ code: 'E_SPEAKER' })]),
	)
	expect(
		await readFile(
			join(
				cache,
				result.registry.entries.find((entry) => entry.id === 'room/dusk')
					?.path ?? '',
			),
			'utf8',
		),
	).toBe('background')
	const pending = result.registry.entries.find(
		(entry) => entry.id === 'future/day',
	)
	expect(pending).toMatchObject({
		status: 'pending',
		path: expect.stringContaining('player/unavailable/'),
	})
	await expect(
		readFile(join(cache, pending?.path ?? '')),
	).rejects.toMatchObject({ code: 'ENOENT' })
	await rm(join(root, 'assets/traveler.png'))
	const missing = await loadPlayerChapter(root, playerWorkId, cache)
	expect(
		missing.registry.entries.find((entry) => entry.id === 'traveler/coat/calm')
			?.path,
	).toContain('player/unavailable/')
	await expect(
		loadPlayerChapter(root, '00000000-0000-0000-0000-000000000000', cache),
	).rejects.toMatchObject({ code: 'not_found' })
	for (const scope of [
		{ level: 'series' },
		{ level: 'volume', volumeId: 'v1' },
		{ level: 'work', volumeId: 'v1', workId: playerWorkId },
	] as const) {
		await rm(join(root, projectFiles.character(scope, 'traveler').path, '..'), {
			recursive: true,
			force: true,
		})
	}
	expect((await loadPlayerChapter(root, playerWorkId, cache)).speakers).toEqual(
		[],
	)
	expect(
		(await loadPlayerChapter(root, playerWorkId, cache)).speakerNames,
	).toEqual({})
	{
		using project = await Project.open(root)
		await project.writeFile(
			projectFiles.character({ level: 'series' }, 'broken').path,
			'{}',
		)
	}
	await expect(
		loadPlayerChapter(root, playerWorkId, cache),
	).rejects.toMatchObject({ code: 'invalid_document' })
	await rm(
		join(root, projectFiles.character({ level: 'series' }, 'broken').path),
	)
	{
		using project = await Project.open(root)
		await project.write(
			projectFiles.assetRegistry({
				level: 'work',
				volumeId: 'v1',
				workId: playerWorkId,
			}),
			{
				formatVersion: 1,
				entries: [
					{
						...room,
						path: '../outside.png',
					},
				],
			},
		)
	}
	await expect(loadPlayerChapter(root, playerWorkId, cache)).rejects.toThrow(
		'Invalid relative project path',
	)
	{
		using project = await Project.open(root)
		const work = await project.read(projectFiles.work('v1', playerWorkId))
		await project.write(projectFiles.work('v1', playerWorkId), {
			...work,
			chapterIds: [],
		})
	}
	await expect(
		loadPlayerChapter(root, playerRef.workId, cache),
	).rejects.toMatchObject({ code: 'not_found' })
})
