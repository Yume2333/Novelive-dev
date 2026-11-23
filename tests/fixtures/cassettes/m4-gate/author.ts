import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConfigStore } from '../../../../packages/creator/src/config'
import { importFileProject } from '../../../../packages/creator/src/import/wizard'
import { createProduction } from '../../../../packages/creator/src/project/production'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { bible, picture } from '../m1b-art/fixture'
import { writeScreeningEpub } from './books'
import {
	completion,
	configuration,
	directory,
	first,
	joined,
	other,
	screeningDirectory,
	screeningReason,
} from './fixture'

process.env.NL_REPLAY = ''
const screening = process.argv.includes('--epub')
const target = screening ? screeningDirectory : directory
let classified = 0

// Authored synthetic responses only: this fetch never delegates to a network.
const synthetic: typeof globalThis.fetch = async (input, init) => {
	const request = new Request(input, init)
	assert.equal(new URL(request.url).origin, 'https://relay.invalid')
	const body = request.headers.get('content-type')?.startsWith('multipart/')
		? Object.fromEntries(await request.formData())
		: await request.json()
	if (new URL(request.url).pathname.includes('/images/')) {
		const [width, height] = String(body.size).split('x').map(Number)
		return Response.json({
			data: [
				{
					b64_json: (
						await picture(width, height, body.background === 'transparent')
					).toString('base64'),
				},
			],
			usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
		})
	}
	const last = body.messages.at(-1).content
	const prompt: string = typeof last === 'string' ? last : last[0].text
	if (prompt.startsWith('Classify this EPUB illustration'))
		return completion(
			classified++ === 0
				? { label: 'character', characterId: 'ada', reason: screeningReason }
				: { label: 'irrelevant', reason: screeningReason },
		)
	if (
		body.tools?.some(
			(tool: { function: { name: string } }) =>
				tool.function.name === 'submit_review',
		)
	)
		return completion({ issues: [] }, 'submit_review')
	if (prompt.startsWith('Write a visual novel adaptation')) {
		const response = completion(
			'scene 启程\nsource p0001\n\n: 一只纸船驶向灯火。',
		)
		if (prompt.includes('p0001: 旅人走过山路。'))
			return new Response(
				': synthetic scheduling window\n\n'.repeat(80) +
					(await response.text()),
				{ headers: response.headers },
			)
		return response
	}
	if (prompt.startsWith('Review prose style only'))
		return completion({ issues: [] })
	if (prompt.startsWith('You are the art director'))
		return completion({
			patch: 'PUT <4:\n@bg gate-room/day',
			items: [
				{ id: 'gate-room/day', kind: 'location', description: '安静的河岸' },
			],
			merges: {},
		})
	if (prompt.startsWith('Write only visible content'))
		return completion({ content: '安静的河岸，远处一点灯火。' })
	if (prompt.startsWith('Visually audit'))
		return completion({ pass: true, failedChecks: [], feedback: '' })
	if (prompt.startsWith('Preview fiction'))
		return completion({
			summary: '纸船启程。',
			characters: [],
			locations: [],
			timelineNotes: [],
			foreshadowingHints: [],
		})
	if (prompt.startsWith('Summarize volume'))
		return completion({ summary: '纸船继续前行。' })
	assert.ok(prompt.includes('Chapter previews:'), prompt.slice(0, 200))
	const ids = [
		...new Set(
			[
				...prompt
					.split('Chapter previews:')[1]
					.matchAll(/"chapterId":"([^"]+)"/g),
			].map((match) => match[1]),
		),
	]
	return completion({
		overview: '纸船与旅人的旅程。',
		chapters: ids.map((chapterId) => ({ chapterId, progress: '继续前行。' })),
		biblePatch: [
			{
				op: 'add',
				kind: 'style',
				entry: {
					id: 'style',
					status: 'candidate',
					description: '柔和赛璐璐插画',
				},
			},
			{
				op: 'add',
				kind: 'location',
				entry: {
					id: 'gate-room',
					name: '河岸',
					status: 'candidate',
					description: '安静的河岸',
				},
			},
			...(screening
				? [
						{
							op: 'add',
							kind: 'character',
							entry: {
								...bible.characters[0],
								status: 'candidate',
								firstSeenChapter: ids[0],
							},
						},
					]
				: []),
		],
		glossaryPatch: [],
	})
}

const root = await mkdtemp(join(homedir(), '.m4-gate-author-'))
try {
	const config = createConfigStore(root)
	await config.update(configuration)
	await rm(join(target, 'cassette.jsonl'), { force: true })
	const record = createReplayFetch({
		mode: 'record',
		directory: target,
		normalizeIds: true,
		rebindIds: true,
		reuseRecorded: true,
		fetch: synthetic,
		case: 'm4-gate',
		tags: ['synthetic', 'no-provider'],
	})
	const production = createProduction(
		root,
		config,
		{ fetch: record },
		() => {},
		() => {},
	)
	try {
		if (screening) {
			const sourcePath = await writeScreeningEpub(root)
			const imported = await importFileProject({
				sourcePath,
				title: 'epub-screening',
				folder: root,
				references: [],
			})
			assert.equal(imported.status, 'ready')
			await production.remember(imported.workId, imported.projectDir)
			const session = await production.get(imported.workId)
			const visual = session.snapshot().visual?.importedIllustrations
			assert.deepEqual(visual?.recommended, ['illustration-1'])
			assert.equal(visual?.candidates.length, 2)
			const group = session.snapshot().visual?.characters[0]
			assert.equal(group?.candidates[0].id, 'costume-epub')
			await session.confirm({
				workId: imported.workId,
				mainVisualId: 'illustration-2',
				supplementalIds: [],
				characters: [
					{
						characterId: group.characterId,
						costumeId: group.costumeId,
						candidateId: 'costume-epub',
					},
				],
			})
			await session.queue.idle()
			assert.notEqual(session.snapshot().phase, 'confirm-visual')
		}
		for (const [title, text] of screening
			? []
			: [
					['纸船', first],
					['山路', other],
				]) {
			const sourcePath = join(root, `${title}.txt`)
			await writeFile(sourcePath, text)
			const imported = await importFileProject({
				sourcePath,
				title,
				folder: root,
				encoding: 'utf-8',
				references: [],
			})
			if (imported.status !== 'ready') throw new Error('Expected ready')
			await production.remember(imported.workId, imported.projectDir)
			const complete = async (workId: string) => {
				const session = await production.get(workId)
				const visual = session.snapshot().visual
				if (visual)
					await session.confirm({
						workId,
						mainVisualId: visual.mainVisuals[0].id,
						characters: [],
						supplementalIds: [],
					})
				await session.queue.idle()
				assert.equal(
					session.snapshot().phase,
					'confirm-first',
					JSON.stringify(session.snapshot()),
				)
				await session.continue()
				await session.queue.idle()
				assert.equal(
					session.snapshot().phase,
					'done',
					JSON.stringify(session.snapshot()),
				)
			}
			await complete(imported.workId)
			if (title === '纸船') {
				const target = await (
					await import('../../../../packages/creator/src/import/wizard/join')
				).readImportTarget(imported.projectDir)
				const path = join(root, 'joined.md')
				await writeFile(path, joined)
				const appended = await importFileProject({
					sourcePath: path,
					title: '远行',
					folder: root,
					references: [],
					join: { projectDir: imported.projectDir, seriesId: target.seriesId },
				})
				if (appended.status !== 'joined') throw new Error('Expected joined')
				await production.remember(appended.workId, imported.projectDir)
				await complete(appended.workId)
			}
		}
	} finally {
		await production.close()
	}
	console.log(
		'Authored synthetic M4 cassettes for three production units, including normal-model chapter two; no provider calls.',
	)
} finally {
	await rm(root, { recursive: true, force: true })
}
