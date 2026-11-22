import { compile } from '@earendil-works/pi-schema'
import { matchPath } from 'react-router-dom'
import { expect, test } from 'vitest'
import {
	commands,
	productionSnapshotEventSchema,
} from '../../packages/creator/src/contract'
import {
	chapterProductionSchema,
	imageJobResultSchema,
	imageQueueItemSchema,
} from '../../packages/format/src/model'
import {
	productionRoutes,
	workRoute,
} from '../../packages/ui/src/routes/production'

const workId = '12345678-0000-4000-8000-000000000001'
const first = {
	chapterId: 'ch1',
	status: 'published',
	priority: true,
	issue: '占位图',
}
const waiting = { chapterId: 'ch2', status: 'waiting', priority: false }

test('the first chapter is published while the work awaits confirmation', () => {
	const snapshot = {
		workId,
		phase: 'confirm-first',
		status: 'confirm',
		chapters: [first, waiting],
		visual: null,
	}
	const { output } = commands['production.get']
	expect(compile(output).check(snapshot)).toBe(true)
	expect(compile(output).check({ ...snapshot, phase: 'published' })).toBe(false)
	expect(
		compile(productionSnapshotEventSchema).check({
			type: 'production.snapshot',
			payload: snapshot,
		}),
	).toBe(true)
	const chapter = compile(chapterProductionSchema)
	expect(chapter.check({ ...first, status: 'needs_attention' })).toBe(false)
	expect(chapter.check({ ...first, status: 'producing' })).toBe(false)
	expect(chapter.check({ ...first, status: 'producing', step: 'draw' })).toBe(
		true,
	)
})

test('visual confirmation requires three main visual candidates and up to two references', () => {
	const { input, output } = commands['production.confirmVisual']
	const snapshot = {
		workId,
		phase: 'confirm-visual',
		status: 'confirm',
		chapters: [waiting],
		visual: {
			mainVisuals: ['one', 'two', 'three'].map((id) => ({
				id,
				cachePath: `visual/${id}.webp`,
			})),
			characters: [],
			supplemental: [],
		},
	}
	expect(compile(output).check(snapshot)).toBe(true)
	expect(
		compile(output).check({
			...snapshot,
			visual: {
				...snapshot.visual,
				mainVisuals: snapshot.visual.mainVisuals.slice(1),
			},
		}),
	).toBe(false)
	const selection = {
		workId,
		mainVisualId: 'one',
		characters: [],
		supplementalIds: ['a', 'b'],
	}
	expect(compile(input).check(selection)).toBe(true)
	expect(
		compile(input).check({ ...selection, supplementalIds: ['a', 'b', 'c'] }),
	).toBe(false)
	expect(
		compile(input).check({ ...selection, supplementalIds: ['a', 'a'] }),
	).toBe(false)
})

test('immediate stop reports cancelled queue entries separately from aborted requests', () => {
	const { input, output } = commands['production.stop']
	expect(compile(input).check({ workId })).toBe(true)
	expect(compile(input).check({ workId, mode: 'after-current' })).toBe(false)
	const stopped = {
		workId,
		mode: 'immediate',
		cancelledQueued: 3,
		abortedRunning: 1,
	}
	expect(compile(output).check(stopped)).toBe(true)
	expect(compile(output).check({ ...stopped, abortedRunning: -1 })).toBe(false)
	expect(
		compile(commands['production.retryChapter'].input).check({ workId }),
	).toBe(false)
})

test('queue requests use registry identities and derivatives name their base asset', () => {
	const queued = compile(imageQueueItemSchema)
	expect(queued.check({ kind: 'location', assetId: 'room/2f' })).toBe(true)
	expect(queued.check({ kind: 'location', assetId: '../room/2f' })).toBe(false)
	const derivative = { kind: 'expression', assetId: '7traveler/coat/smile' }
	expect(queued.check(derivative)).toBe(false)
	expect(
		queued.check({ ...derivative, baseAssetId: '7traveler/coat/calm' }),
	).toBe(true)
	const result = compile(imageJobResultSchema)
	expect(result.check({ status: 'drawn' })).toBe(true)
	expect(result.check({ status: 'placeholder', issue: '绘制失败' })).toBe(true)
	expect(result.check({ status: 'unsupported', issue: '接口不支持' })).toBe(
		true,
	)
	expect(result.check({ status: 'unsupported' })).toBe(false)
})

test('resource lookup uses a work-scoped asset ID and returns a host cache path', () => {
	const { input, output } = commands['production.resolveAsset']
	expect(compile(input).check({ workId, assetId: 'room/dusk' })).toBe(true)
	expect(compile(input).check({ workId, assetId: '../outside' })).toBe(false)
	expect(compile(output).check({ cachePath: 'work/room/dusk.webp' })).toBe(true)
	expect(compile(output).check(null)).toBe(true)
	expect(compile(output).check({ cachePath: '' })).toBe(false)
})

test('each work route yields the same work ID when mounted', () => {
	for (const route of [
		'work',
		'play',
		'production',
		'confirmVisual',
		'confirmFirst',
	] as const) {
		expect(
			matchPath(productionRoutes[route], workRoute(route, workId))?.params.id,
		).toBe(workId)
	}
	expect(productionRoutes.import).toBe('/import')
})
