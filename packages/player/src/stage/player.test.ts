import { compileScript } from '@novelive/format/script'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { context } from '../../../../tests/fixtures/script/context'
import { minimalControlsController } from '../../../ui/src/pages/player/controls/minimal-controller'
import type { StageSnapshot } from '../contract'
import { PlaybackProgress } from '../progress'
import { mountText } from '../text'
import { AssetWindow } from './assets'
import { mountMinimalPlayer } from './index'
import { PixiStage } from './renderer'

vi.mock('./renderer', () => ({
	PixiStage: class {
		async mount() {}
		complete() {}
		async commit() {}
		destroy() {}
	},
}))
vi.mock('./assets', () => ({
	AssetWindow: class {
		async sync() {}
		async destroy() {}
	},
	lookahead: () => [],
}))
vi.mock('../text', () => ({
	mountText: vi.fn(() => ({
		finished: Promise.resolve(),
		click: () => false,
		dispose: vi.fn(),
	})),
}))

class Element extends EventTarget {
	className = ''
	textContent = ''
	dataset = {}
	style = { getPropertyValue: () => '' }
	append() {}
	replaceChildren() {}
	remove() {}
	querySelector() {
		return null
	}
	getBoundingClientRect() {
		return { top: 0, bottom: 540, height: 540 }
	}
}

beforeEach(() => {
	vi.mocked(mountText).mockImplementation(() => ({
		finished: Promise.resolve(),
		click: () => false,
		dispose: vi.fn(),
	}))
	vi.stubGlobal('document', { createElement: () => new Element() })
	vi.stubGlobal(
		'MutationObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
	vi.unstubAllGlobals()
})

function fixture() {
	const compiled = compileScript(
		'scene 夜\nsource p0001\n@bg room/dusk transition none\n@show traveler/coat/calm center\n: First #0001\n@move center left duration 0.01\n: Second #0002\n: Third #0003',
		{ ...context, paragraphIds: ['p0001'], sceneIds: ['aaaabbbb'] },
	)
	if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
	return compiled.scenes
}
const position = {
	chapterId: 'chapter',
	sceneId: 'aaaabbbb',
	sentenceId: '0002',
}
const resources = { resolveAsset: (id: string) => id }

it('preserves main custom-mark styling and viewport metrics when mounting stage text', async () => {
	const abort = new AbortController()
	const customMarks = { accent: { css: 'font-size: 42px', perChar: true } }
	await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		fixture(),
		resources,
		abort.signal,
		vi.fn(),
		{},
		undefined,
		{ customMarks },
	)
	expect(mountText).toHaveBeenLastCalledWith(
		expect.anything(),
		expect.anything(),
		expect.objectContaining({
			customMarks,
			viewport: {
				element: expect.anything(),
				textHeight: expect.any(Function),
			},
		}),
	)
	abort.abort()
})

it('does not install a blank opening for empty preview history before the first background fade', async () => {
	const scenes = fixture()
	scenes[0].beats[0].actions[0].args = { transition: 'fade', duration: 0.5 }
	const commit = vi.spyOn(PixiStage.prototype, 'commit')
	const abort = new AbortController()
	const ordinary = await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		scenes,
		resources,
		abort.signal,
		vi.fn(),
	)
	expect(commit).toHaveBeenCalledTimes(1)
	commit.mockClear()
	const preview = await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		scenes,
		resources,
		abort.signal,
		vi.fn(),
		{},
		undefined,
		{ initialActions: [] },
	)
	expect(commit).toHaveBeenCalledTimes(1)
	expect(commit.mock.calls[0][3]).toBe(false)
	expect(preview?.state).toEqual(ordinary?.state)
	abort.abort()
})

it('starts at the requested sentence, reconstructs prior state, and delivers original beats and canonical snapshots', async () => {
	const host = new Element()
	const abort = new AbortController()
	const scenes = fixture()
	const rendered = vi.fn()
	const snapshots = vi.fn()
	const player = await mountMinimalPlayer(
		host as unknown as HTMLElement,
		scenes,
		resources,
		abort.signal,
		vi.fn(),
		{},
		rendered,
		{ start: position, onSnapshot: snapshots },
	)
	expect(rendered).toHaveBeenLastCalledWith(scenes[0].beats[1])
	expect(player?.state.background?.assetId).toBe('room/dusk')
	expect(player?.state.sprites.center?.transform.x).toBe(240)
	expect(snapshots.mock.calls[0][0]).toMatchObject({
		position,
		active: [{ restore: 'restart-text' }],
	})
	host.dispatchEvent(new Event('click'))
	await vi.waitFor(() =>
		expect(rendered).toHaveBeenLastCalledWith(scenes[0].beats[2]),
	)
	host.dispatchEvent(new Event('click'))
	await vi.waitFor(() => expect(rendered).toHaveBeenLastCalledWith(undefined))
	expect(snapshots).toHaveBeenCalledTimes(2)
	abort.abort()
})

it('publishes the new canonical save and history while its move is still animating', async () => {
	const elements = vi.spyOn(document, 'createElement')
	const host = new Element()
	const abort = new AbortController()
	const scenes = fixture()
	const snapshots = vi.fn()
	const rendered = vi.fn()
	const player = await mountMinimalPlayer(
		host as unknown as HTMLElement,
		scenes,
		resources,
		abort.signal,
		vi.fn(),
		{},
		rendered,
		{ chapterId: 'chapter', onSnapshot: snapshots },
	)
	const animation = Promise.withResolvers<void>()
	vi.spyOn(PixiStage.prototype, 'commit').mockReturnValueOnce(animation.promise)
	host.dispatchEvent(new Event('click'))
	await vi.waitFor(() => expect(snapshots).toHaveBeenCalledTimes(2))
	expect(rendered).toHaveBeenLastCalledWith(scenes[0].beats[1])
	const saved = snapshots.mock.calls[1][0] as StageSnapshot
	const stage = elements.mock.results.find(
		({ value }) => value.className === 'nl-player-stage',
	)?.value
	expect(stage?.ariaBusy).toBe('true')
	expect(saved.position).toEqual(position)
	expect(saved.stage.sprites.center?.transform.x).toBe(240)
	expect(saved.active).toEqual([{ restore: 'restart-text' }])
	expect(player?.snapshot).toEqual(saved)
	expect(player?.progress.history.entries).toHaveLength(2)
	expect(player?.progress.history.entries.at(-1)).toEqual(saved)
	const complete = vi
		.spyOn(PixiStage.prototype, 'complete')
		.mockImplementation(() => animation.resolve())
	host.dispatchEvent(new Event('click'))
	expect(complete).toHaveBeenCalledOnce()
	await vi.waitFor(() => expect(stage?.ariaBusy).toBe('false'))
	expect(rendered).toHaveBeenCalledTimes(2)
	expect(rendered).toHaveBeenLastCalledWith(scenes[0].beats[1])
	expect(player?.progress.history.entries).toHaveLength(2)
	await player?.restore(saved)
	expect(player?.state).toEqual(saved.stage)
	abort.abort()
})

it('stops skip-read at an animated unread auto sentence before it can bypass text waits', async () => {
	vi.useFakeTimers()
	try {
		const scenes = fixture()
		scenes[0].beats[0].advance = { kind: 'auto' }
		scenes[0].beats[1].advance = { kind: 'auto' }
		const first = { ...position, sentenceId: '0001' }
		const progress = new PlaybackProgress(() => 0, {
			mainline: first,
			read: [first],
			saves: [],
		})
		const host = new Element() as unknown as HTMLElement
		const abort = new AbortController()
		const controls = minimalControlsController(
			host,
			'chapter',
			scenes,
			'main',
			progress,
			abort.signal,
		)
		const unread = Promise.withResolvers<void>()
		vi.mocked(mountText).mockImplementation((_, content) => ({
			finished: content.some(
				(part) => part.type === 'text' && part.text === 'Second',
			)
				? unread.promise
				: Promise.resolve(),
			click: () => false,
			dispose: vi.fn(),
		}))
		await mountMinimalPlayer(
			host,
			scenes,
			resources,
			abort.signal,
			vi.fn(),
			{},
			controls.rendered,
			{ chapterId: 'chapter', onSnapshot: (saved) => progress.record(saved) },
		)
		expect(controls.frame().read).toBe(true)
		const animation = Promise.withResolvers<void>()
		vi.spyOn(PixiStage.prototype, 'commit').mockReturnValueOnce(
			animation.promise,
		)
		controls.advance(true)
		await vi.advanceTimersByTimeAsync(0)
		expect(controls.frame()).toMatchObject({
			position,
			read: false,
			scripted: true,
		})
		const calls = vi.mocked(mountText).mock.calls.length
		controls.advance(true)
		expect(mountText).toHaveBeenCalledTimes(calls)
		expect(mountText).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ auto: true, skip: false }),
		)
		animation.resolve()
		unread.resolve()
		abort.abort()
	} finally {
		vi.useRealTimers()
	}
})

it('prefers restored position over start, replays saved state, and does not rerun the sentence move', async () => {
	const scenes = fixture()
	const abort = new AbortController()
	const original = await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		scenes,
		resources,
		abort.signal,
		vi.fn(),
		{},
		undefined,
		{ chapterId: 'chapter' },
	)
	const saved = structuredClone(original?.snapshot) as StageSnapshot
	saved.position = position
	const sprite = saved.stage.sprites.center
	if (!sprite) throw new Error('Missing fixture portrait')
	sprite.transform.x = 123
	saved.active = [
		{
			restore: 'replay-state',
			action: {
				type: 'action',
				name: 'filter',
				args: { effect: 'brightness', value: 0.5 },
				assets: [],
				line: 1,
				col: 1,
			},
		},
	]
	const rendered = vi.fn()
	const snapshots = vi.fn()
	const player = await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		scenes,
		resources,
		abort.signal,
		vi.fn(),
		{},
		rendered,
		{
			chapterId: 'chapter',
			restore: saved,
			start: { ...position, sentenceId: '0003' },
			onSnapshot: snapshots,
		},
	)
	expect(player?.state.sprites.center?.transform.x).toBe(123)
	expect(player?.state.filter).toEqual({ effect: 'brightness', value: 0.5 })
	expect(rendered).toHaveBeenLastCalledWith(scenes[0].beats[1])
	expect(snapshots.mock.calls[0][0].position).toEqual(position)
	expect(mountText).toHaveBeenLastCalledWith(
		expect.anything(),
		saved.stage.text.content,
		expect.objectContaining({ auto: false }),
	)
	abort.abort()
})

it('reports empty playback, missing start positions and stage loading errors without publishing snapshots', async () => {
	const abort = new AbortController()
	const rendered = vi.fn()
	const snapshots = vi.fn()
	await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		[],
		resources,
		abort.signal,
		vi.fn(),
		{},
		rendered,
		{ onSnapshot: snapshots },
	)
	expect(rendered).toHaveBeenCalledWith(undefined)
	await expect(
		mountMinimalPlayer(
			new Element() as unknown as HTMLElement,
			fixture(),
			resources,
			abort.signal,
			vi.fn(),
			{},
			rendered,
			{ start: { ...position, sentenceId: 'removed' } },
		),
	).rejects.toThrow('存档中的句子已不存在')
	vi.spyOn(AssetWindow.prototype, 'sync').mockRejectedValueOnce(
		new Error('missing asset'),
	)
	const error = vi.fn()
	await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		fixture(),
		resources,
		abort.signal,
		error,
		{},
		undefined,
		{ onSnapshot: snapshots },
	)
	expect(error).toHaveBeenCalledWith(new Error('missing asset'))
	expect(snapshots).not.toHaveBeenCalled()
	abort.abort()
})

it('restarts restored text using the destination sentence advancement mode', async () => {
	const scenes = fixture()
	scenes[0].beats[1].advance = { kind: 'auto' }
	const abort = new AbortController()
	const player = await mountMinimalPlayer(
		new Element() as unknown as HTMLElement,
		scenes,
		resources,
		abort.signal,
		vi.fn(),
		{},
		undefined,
		{ chapterId: 'chapter' },
	)
	const first = player?.snapshot
	if (!first || !player) throw new Error('Missing fixture snapshot')
	await player.restore({ ...first, position })
	expect(mountText).toHaveBeenLastCalledWith(
		expect.anything(),
		expect.anything(),
		expect.objectContaining({ auto: true, continueImmediately: true }),
	)
	await player.restore(first)
	expect(mountText).toHaveBeenLastCalledWith(
		expect.anything(),
		expect.anything(),
		expect.objectContaining({ auto: false, continueImmediately: false }),
	)
	abort.abort()
})

it('holds scripted delay until text finishes and responds to text-setting and skip events', async () => {
	vi.useFakeTimers()
	try {
		const scenes = fixture()
		scenes[0].beats[0].advance = { kind: 'delay', seconds: 1 }
		const text = Promise.withResolvers<void>()
		vi.mocked(mountText).mockReturnValueOnce({
			finished: text.promise,
			click: () => false,
			dispose: vi.fn(),
		})
		const host = new Element()
		const abort = new AbortController()
		const rendered = vi.fn()
		await mountMinimalPlayer(
			host as unknown as HTMLElement,
			scenes,
			resources,
			abort.signal,
			vi.fn(),
			{},
			rendered,
		)
		await vi.advanceTimersByTimeAsync(2000)
		expect(rendered).toHaveBeenCalledTimes(1)
		host.dispatchEvent(new Event('novelive:player-skip'))
		expect(mountText).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ skip: true }),
		)
		text.resolve()
		await vi.advanceTimersByTimeAsync(999)
		expect(rendered).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(rendered).toHaveBeenLastCalledWith(scenes[0].beats[1])
		host.style.getPropertyValue = () => '10'
		host.dispatchEvent(new Event('novelive:player-settings'))
		expect(mountText).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ millisecondsPerCharacter: 10 }),
		)
		abort.abort()
	} finally {
		vi.useRealTimers()
	}
})
