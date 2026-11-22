import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { Project } from '../../packages/creator/src/project'
import { loadPlayerChapter } from '../../packages/creator/src/project/player'
import { projectFiles } from '../../packages/format/src/model'
import { type Beat, compileScript } from '../../packages/format/src/script'
import { createPlayback } from '../../packages/player/src/minimal/playback'
import {
	playerRef,
	playerScript,
	playerWorkId,
	seedPlayerProject,
} from '../fixtures/minimal-player'
import { context } from '../fixtures/script/context'

const directories: string[] = []
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
	expect(result.speakers).toEqual(['traveler', 'listener', 'witness'])
	expect(
		result.registry.entries.some((entry) => entry.id.startsWith('listener/')),
	).toBe(false)
	const compiled = compileScript(result.script, {
		paragraphIds: result.chapter.paragraphIds,
		sceneIds: result.chapter.sceneIds,
		assets: result.registry.entries,
		speakers: result.speakers,
	})
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
		}).diagnostics,
	).toEqual(
		expect.arrayContaining([expect.objectContaining({ code: 'E_SPEAKER' })]),
	)
	expect(
		await readFile(join(cache, result.registry.entries[0].path), 'utf8'),
	).toBe('background')
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
				entries: [{ ...result.registry.entries[0], path: '../outside.png' }],
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
