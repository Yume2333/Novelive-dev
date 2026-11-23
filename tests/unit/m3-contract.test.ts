import { readFileSync } from 'node:fs'
import { expect, expectTypeOf, test } from 'vitest'
import { compileScript } from '../../packages/format/src/script'
import {
	assetLookahead,
	type ChapterEnd,
	historyLimit,
	manualSaveSlots,
	type PlaybackHistory,
	type PlayerChapters,
	type PlayerResources,
	type StageSnapshot,
	saveThumbnail,
	toPlaybackBeats,
	type WorkProgress,
} from '../../packages/player/src/contract'
import { playerEditorRoute } from '../../packages/ui/src/routes/player'
import { context } from '../fixtures/script/context'

const sceneIds = ['aaaabbbb', 'ccccdddd']
const chapterId = 'ch0001'
const position = { chapterId, sceneId: sceneIds[0], sentenceId: 'a3f9' }
const script = readFileSync(
	new URL('../fixtures/script/synthetic.nvs', import.meta.url),
	'utf8',
)

function chapterBeats() {
	const compiled = compileScript(
		script
			.replace('@caption 夜幕', '@caption 夜幕 #a3f8')
			.replace('@wait\n', '@wait #a3f7\n')
			.replace('@wait 0.2\n', '@wait 0.2 #a3f6\n'),
		{ ...context, sceneIds },
	)
	if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
	return toPlaybackBeats(chapterId, compiled.scenes, { traveler: '旅人' })
}

test('projects the compiled chapter without losing direction order, resolved assets, text marks, or timing', () => {
	const beats = chapterBeats()
	expect(
		beats.flatMap(({ actions }) => actions.map(({ name }) => name)),
	).toEqual([
		'bg',
		'fg',
		'show',
		'move',
		'shake',
		'zoom',
		'particle',
		'mask',
		'camera',
		'filter',
		'cg',
		'bg',
		'face',
		'costume',
		'face',
		'hide',
		'fg',
		'cg',
		'particle',
		'filter',
		'mask',
		'camera',
	])
	expect(beats[0]).toMatchObject({
		sceneId: sceneIds[0],
		cue: {
			kind: 'text',
			position,
			text: {
				kind: 'dialogue',
				speaker: 'traveler',
				displayName: '访客',
				content: expect.arrayContaining([
					{ type: 'open', name: 'whisper' },
					{ type: 'pause', seconds: 0.6 },
					{ type: 'open', name: 'speed', argument: '0.5' },
					{ type: 'open', name: 'ruby', argument: 'ま' },
				]),
			},
		},
		advance: { kind: 'auto' },
	})
	expect(beats[1].cue).toMatchObject({
		kind: 'text',
		position: { ...position, sentenceId: 'a3f8' },
		text: { kind: 'caption' },
	})
	expect(beats[3]).toMatchObject({
		sceneId: sceneIds[0],
		cue: { kind: 'wait', lineId: 'a3f7' },
		advance: { kind: 'click' },
	})
	expect(beats[3].actions.map(({ name }) => name)).toContain('cg')
	expect(beats[4]).toMatchObject({
		sceneId: sceneIds[1],
		actions: [
			{ name: 'bg', args: { transition: 'none' } },
			{ name: 'face', assets: [{ id: 'traveler/coat/smile', slot: 'left' }] },
		],
		cue: {
			kind: 'text',
			text: {
				kind: 'inner',
				displayName: '旅人',
				content: expect.arrayContaining([{ type: 'open', name: 'wave' }]),
			},
		},
	})
	expect(beats[5]).toMatchObject({
		sceneId: sceneIds[1],
		cue: { kind: 'wait', lineId: 'a3f6' },
		advance: { kind: 'delay', seconds: 0.2 },
	})
	expect(beats[6].cue).toMatchObject({
		kind: 'text',
		text: { kind: 'narration' },
	})
	expect(beats.at(-1)).toMatchObject({
		cue: { kind: 'stage' },
		advance: { kind: 'auto' },
	})
})

test('a bare wait cue retains its compiler-assigned line ID', () => {
	const compiled = compileScript('scene 夜\nsource p0001\n@wait', {
		...context,
		paragraphIds: ['p0001'],
		sceneIds: [sceneIds[0]],
		makeId: () => '1a2b',
	})
	if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
	expect(toPlaybackBeats(chapterId, compiled.scenes, {})).toMatchObject([
		{
			sceneId: sceneIds[0],
			cue: { kind: 'wait', lineId: '1a2b' },
			advance: { kind: 'click' },
		},
	])
})

test('speaker IDs fall back to text when a name exists only on the map prototype', () => {
	const compiled = compileScript(
		'scene 夜\nsource p0001\nconstructor: 谁？ #0001',
		{
			paragraphIds: ['p0001'],
			sceneIds: [sceneIds[0]],
			assets: [],
			speakers: ['constructor'],
		},
	)
	if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
	expect(toPlaybackBeats(chapterId, compiled.scenes, {})[0].cue).toMatchObject({
		kind: 'text',
		text: { speaker: 'constructor', displayName: 'constructor' },
	})
	expect(
		toPlaybackBeats(chapterId, compiled.scenes, { constructor: '来客' })[0].cue,
	).toMatchObject({ kind: 'text', text: { displayName: '来客' } })
})

test('save and cross-chapter history use sentence-addressed JSON snapshots with explicit restore strategies', () => {
	const [{ actions, cue }] = chapterBeats()
	if (cue.kind !== 'text') throw new Error('Expected dialogue cue')
	const snapshot: StageSnapshot = {
		position: cue.position,
		stage: {
			background: {
				assetId: 'room/dusk',
				transition: { fromAssetId: null, name: 'fade', durationSeconds: 1.5 },
			},
			sprites: {
				left: {
					assetId: 'traveler/coat/calm',
					position: 'center',
					transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
					layer: 1,
				},
			},
			cg: 'cg-window',
			foreground: 'cg-window',
			camera: {
				motion: 'sway',
				zoom: { scale: 1.08, target: 'center' },
				shake: { strength: 0.35 },
			},
			particle: { effect: 'rain', intensity: 0.4, speed: 1, angle: -25 },
			mask: { shape: 'vignette', strength: 0.7 },
			filter: { effect: 'sepia', value: 0.4 },
			text: cue.text,
		},
		active: [
			{ restore: 'replay-state', action: actions[0] },
			{ restore: 'restart-text' },
			{ restore: 'skip-relative' },
		],
	}
	const next = { ...snapshot, position: { ...position, chapterId: 'ch0002' } }
	const history: PlaybackHistory = { entries: [snapshot, next], cursor: 0 }
	const progress: WorkProgress = {
		mainline: next.position,
		read: history.entries.map(({ position }) => position),
		saves: [
			{
				slot: { kind: 'quick' },
				savedAt: '2026-11-23T00:00:00Z',
				snapshot,
				thumbnailRef: 'quick.webp',
			},
			{
				slot: { kind: 'manual', slot: 60 },
				savedAt: '2026-11-23T00:00:00Z',
				snapshot: next,
				thumbnailRef: '60.webp',
			},
		],
	}
	expect(history.entries[history.cursor ?? -1].position).toEqual(position)
	expect(JSON.parse(JSON.stringify(progress))).toEqual(progress)
	expectTypeOf<StageSnapshot['position']>().not.toHaveProperty('page')
	expect(historyLimit).toBe(200)
	expect(manualSaveSlots).toBe(60)
	expect(saveThumbnail).toEqual({ width: 480, height: 270, mime: 'image/webp' })
})

test('the host resolves registered asset references and distinguishes chapter waiting from completion', () => {
	expect(assetLookahead).toEqual({ minimum: 20, default: 32 })
	expectTypeOf<PlayerResources['resolveAsset']>().toEqualTypeOf<
		(id: string) => string | Promise<string>
	>()
	expectTypeOf<ChapterEnd>().toEqualTypeOf<
		| { kind: 'end' }
		| { kind: 'ready'; chapterId: string }
		| { kind: 'waiting'; chapterId: string }
		| {
				kind: 'producing'
				chapterId: string
				step: 'write' | 'review' | 'stage' | 'draw'
		  }
	>()
	expectTypeOf<PlayerChapters['watchNext']>().toEqualTypeOf<
		(chapterId: string, onChange: (event: ChapterEnd) => void) => () => void
	>()
})

test('links to the canonical editor route with an encoded stable sentence location', () => {
	const url = new URL(
		playerEditorRoute('work-1', { ...position, chapterId: 'chapter + 1' }),
		'https://novelive.test',
	)
	expect(url.pathname).toBe('/work/work-1/edit')
	expect(Object.fromEntries(url.searchParams)).toEqual({
		chapterId: 'chapter + 1',
		sceneId: position.sceneId,
		lineId: position.sentenceId,
	})
})
