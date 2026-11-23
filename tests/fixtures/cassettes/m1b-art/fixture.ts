import { type AssetRegistry, projectFiles } from '@novelive/format/model'
import sharp from 'sharp'
import {
	type ArtBible,
	ArtProduction,
	directChapterArt,
} from '../../../../packages/creator/src/pipeline/art'
import type { Project } from '../../../../packages/creator/src/project'
import type { ReplayOptions } from '../../../../packages/creator/src/replay'

export const directory = 'tests/fixtures/cassettes/m1b-art'
const baseUrl = 'https://relay.invalid/v1'
const apiKey = 'offline-placeholder'
const text = {
	baseUrl,
	apiKey,
	contextWindow: 12_000,
	maxOutputTokens: 4096,
	format: 'openai-completions',
	compat: 'auto',
} as const
export const main = { ...text, model: 'fixture-art-main' }
export const bible: ArtBible = {
	style: { id: 'style', status: 'candidate', description: '柔和赛璐璐插画' },
	characters: [
		{
			id: 'ada',
			name: 'Ada',
			aliases: [],
			status: 'confirmed',
			firstSeenChapter: 'c1',
			major: true,
			costumes: [{ id: 'uniform', description: '蓝色制服' }],
			expressions: [{ id: 'angry', description: '双眉压低、牙关紧咬' }],
			appearance: {
				description: '黑发、蓝眼',
				anchorFeatures: ['黑发', '发卡'],
				keyColors: {
					hair: 'black hair',
					eyes: 'blue eyes',
					clothing: 'blue uniform',
				},
			},
		},
	],
	locations: [
		{
			id: 'room',
			name: 'Room',
			status: 'confirmed',
			description: '教室，中央一扇窗',
		},
	],
}
export const empty: AssetRegistry = { formatVersion: 1, entries: [] }
export const script =
	'scene 教室\nsource p0001-p0001\n\nada: 窗外下雨了。 #0010\n'
export const directorResult = {
	patch:
		'PUT <4:\n@bg room/rain\n@show ada/uniform/furious center\n@cg cg-window\nPUT >4:\n@show ada/coat/neutral center',
	items: [
		{ id: 'room/rain', kind: 'variant', description: '窗外下着雨' },
		{
			id: 'ada/uniform/furious',
			kind: 'expression',
			description: '眉毛压低的立绘',
		},
		{ id: 'cg-window', kind: 'cg', description: 'Ada 在教室窗前' },
		{ id: 'ada/coat/neutral', kind: 'character', description: 'Ada 换上外套' },
	],
	merges: { 'ada/uniform/furious': 'ada/uniform/angry' },
}

export const projectSeed = {
	formatVersion: 1,
	seriesId: 'art-fixture',
	title: 'The classroom',
	volumeIds: ['v1'],
} as const

export function service(
	project: Project,
	replay: ReplayOptions,
	imageModel = 'fixture-art-image',
	visualModel = 'fixture-art-visual',
) {
	return new ArtProduction(project, {
		replay,
		main,
		fast: { ...text, model: 'fixture-art-fast' },
		visual: { ...text, model: visualModel },
		image: {
			baseUrl,
			apiKey,
			model: imageModel,
			nativeMaxEdge: 1536,
			concurrency: 2,
			retries: 1,
			quality: 'medium',
			postProcess: 'off',
			upscaleTier: 'anime',
		},
	})
}

export function picture(width: number, height: number, transparent: boolean) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	${transparent ? '' : `<rect width="${width}" height="${height}" fill="#567"/>`}
	<rect x="${width / 3}" y="${height / 8}" width="${width / 3}" height="${(height * 7) / 8}" fill="#456def"/>
	</svg>`
	const image = sharp(Buffer.from(svg))
	return (transparent ? image : image.removeAlpha()).png().toBuffer()
}

export async function runArt(project: Project, replay: ReplayOptions) {
	const art = service(project, replay)
	await project.writeFile(
		'assets/creator-style.png',
		await picture(320, 180, false),
	)
	const pool = await art.candidates(bible, ['c1'], undefined, [
		{ id: 'creator-style', cachePath: 'assets/creator-style.png' },
	])
	const style = await art.confirmVisual(bible.style, pool, {
		mainVisualId: 'visual-2',
		supplementalIds: ['creator-style'],
		characters: [
			{ characterId: 'ada', costumeId: 'uniform', candidateId: 'costume-3' },
		],
	})
	const confirmed = { ...bible, style }
	const manifest = await directChapterArt(
		script,
		confirmed,
		await art.registry(),
		{ main, replay },
	)
	const chapter = {
		volumeId: 'v1',
		workId: '00000000-0000-0000-0000-000000000001',
		chapterId: 'c1',
	}
	await project.write(projectFiles.chapter(chapter), {
		formatVersion: 1,
		chapterId: 'c1',
		title: '教室',
		sceneIds: [],
		paragraphIds: ['p0001'],
		cg: [],
	})
	const jobs = await art.register(
		manifest.items,
		confirmed,
		manifest.merges,
		chapter,
	)
	const results = []
	for (const job of jobs)
		results.push(
			await art.draw(job, confirmed, manifest.cgReferences.get(job.assetId)),
		)
	return { art, pool, style, manifest, jobs, results, confirmed, chapter }
}

export async function runFailures(project: Project, replay: ReplayOptions) {
	const art = service(project, replay, 'fixture-art-bad-image')
	const jobs = await art.register(
		[
			{
				id: 'broken/neutral/neutral',
				kind: 'character',
				description: '损坏立绘',
			},
			{ id: 'broken/day', kind: 'location', description: '损坏背景' },
			{ id: 'cg-rejected', kind: 'cg', description: '审核不通过' },
			{ id: 'cg-unsupported', kind: 'cg', description: '接口能力不支持' },
			{ id: 'cg-moderated', kind: 'cg', description: '内容审核' },
		],
		bible,
	)
	const results = []
	for (const job of jobs) {
		const renderer =
			job.assetId === 'cg-rejected'
				? service(
						project,
						replay,
						'fixture-art-image',
						'fixture-art-visual-fail',
					)
				: job.assetId === 'cg-unsupported'
					? service(project, replay, 'fixture-art-unsupported')
					: job.assetId === 'cg-moderated'
						? service(project, replay, 'fixture-art-moderation')
						: art
		results.push(await renderer.draw(job, bible))
	}
	return { art, jobs, results }
}
