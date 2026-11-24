import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { bool, obj } from '@earendil-works/pi-schema'
import { projectFiles } from '@novelive/format/model'
import { compileScript } from '@novelive/format/script'
import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import { ArtProduction } from '../../packages/creator/src/pipeline/art'
import * as background from '../../packages/creator/src/pipeline/art/background'
import { checkImage } from '../../packages/creator/src/pipeline/art/check'
import {
	applyStagingPatch,
	directChapterArt,
} from '../../packages/creator/src/pipeline/art/director'
import * as artModels from '../../packages/creator/src/pipeline/art/models'
import {
	type ManifestItem,
	planArt,
	playbackAssetIds,
} from '../../packages/creator/src/pipeline/art/plan'
import { trimStagingToBudget } from '../../packages/creator/src/pipeline/art/trim'
import * as upscale from '../../packages/creator/src/pipeline/postprocess'
import { Project } from '../../packages/creator/src/project'
import {
	projectSpend,
	quoteSpend,
} from '../../packages/creator/src/usage/spend'
import {
	bible,
	directory,
	empty,
	main,
	picture,
	projectSeed,
	runArt,
	runFailures,
	script,
	service,
} from '../fixtures/cassettes/m1b-art/fixture'

const { readProfiles } = upscale

const replay = {
	directory,
	mode: 'strict',
	fetch: async () => {
		throw new Error('Offline test cannot call upstream')
	},
} as const

test.each([
	['fenced JSON', '```json\n{"pass":true}\n```'],
	['compact fenced JSON', '```json{"pass":true}```'],
	['leading prose', 'Here is the review:\n\n```\n{"pass":true}\n```'],
	[
		'trailing prose',
		'```json\n{"pass":true}\n```\n\nThe result is acceptable.',
	],
	['bare JSON', '{"pass":true}'],
])('decodes a visual-review JSON object with %s', async (_shape, content) => {
	const chunk = {
		choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
	}
	const result = await artModels.artJson(
		main,
		'Review the image.',
		obj({ pass: bool() }),
		{
			replay: {
				mode: 'replay',
				directory,
				fetch: async () =>
					new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
						headers: { 'content-type': 'text/event-stream' },
					}),
			},
		},
	)
	expect(result).toEqual({ pass: true })
})

function artReplies(...replies: string[]) {
	return vi.fn<typeof globalThis.fetch>(async () => {
		const content = replies.shift()
		if (content === undefined) throw new Error('Unexpected art request')
		const chunk = {
			choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		}
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
			headers: { 'content-type': 'text/event-stream' },
		})
	})
}

test.each([true, false])(
	'bounds art JSON repair (valid repair: %s)',
	async (valid) => {
		const malformed = '{"pass":true "unused":false}'
		const fetch = artReplies(malformed, valid ? '{"pass":true}' : malformed)
		const result = artModels.artJson(
			main,
			'Review the image.',
			obj({ pass: bool() }),
			{
				replay: { ...replay, mode: 'replay', fetch },
			},
		)
		if (valid) await expect(result).resolves.toEqual({ pass: true })
		else await expect(result).rejects.toThrow('Art model returned invalid JSON')
		expect(fetch).toHaveBeenCalledTimes(2)
		const [input, init] = fetch.mock.calls[1]
		expect(
			JSON.stringify((await new Request(input, init).json()).messages),
		).toContain('Return only corrected JSON')
	},
)

async function projectTest(run: (project: Project) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), 'novelive-m1b-art-'))
	try {
		using project = await Project.create(join(dir, 'project'), {
			...projectSeed,
			volumeIds: ['v1'],
		})
		await run(project)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

test('stops without a staging repair when the malformed reply did not settle', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-staging-usage-'))
	using db = new DatabaseSync(':memory:')
	const fetch = vi.fn<typeof globalThis.fetch>(async () => {
		const frame = {
			choices: [
				{
					index: 0,
					delta: { content: '{"patch":"" "items":[]}' },
					finish_reason: 'stop',
				},
			],
		}
		return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
			headers: { 'content-type': 'text/event-stream' },
		})
	})
	vi.stubEnv('NL_RUN_TOKEN_CAP', '1000000')
	vi.stubEnv('NL_RUN_IMAGE_CAP', '0')
	vi.stubEnv('NL_RUN_TOKEN_SOFT_FRACTION', '1')
	try {
		await expect(
			directChapterArt(script, bible, empty, {
				main,
				replay: { mode: 'record', directory, fetch, spend: projectSpend(db) },
			}),
		).rejects.toThrow(
			'Model request outcome unknown; not retried automatically',
		)
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(
			db.prepare('SELECT actual_tokens FROM spend_reservation').all(),
		).toEqual([{ actual_tokens: null }])
	} finally {
		vi.unstubAllEnvs()
		await rm(directory, { recursive: true, force: true })
	}
})

test('parallel jobs serialize registry updates across art service instances', async () => {
	await projectTest(async (project) => {
		const art = service(project, replay)
		const [day] = await art.register(
			[{ id: 'room/day', kind: 'location', description: 'Sunny' }],
			bible,
		)
		const [cg] = await art.register(
			[{ id: 'cg-window', kind: 'cg', description: 'A window' }],
			bible,
		)
		const { entries } = await art.registry()
		await Promise.all(
			entries.map(({ path }) =>
				project.writeFile(path, Buffer.from('existing image')),
			),
		)
		await Promise.all(
			[day, cg].map((job) => service(project, replay).draw(job, bible)),
		)
		expect((await art.registry()).entries.map(({ status }) => status)).toEqual([
			'drawn',
			'drawn',
		])
	})
})

test('confirms three main visuals and costumes, stages the chapter and draws canonical assets in strict replay', async () => {
	await projectTest(async (project) => {
		const { art, pool, style, manifest, jobs, results, confirmed, chapter } =
			await runArt(project, replay)
		expect(pool.mainVisuals).toHaveLength(3)
		expect(pool.characters).toMatchObject([
			{ characterId: 'ada', costumeId: 'uniform' },
		])
		expect(pool.characters[0].candidates).toHaveLength(3)
		expect(style.references?.map(({ path }) => path)).toEqual([
			'assets/style/main-visual.webp',
			'assets/style/supplemental-1.webp',
		])
		expect(
			(await project.read(projectFiles.style({ level: 'series' }))).entries,
		).toEqual([style])
		expect(manifest.script).toContain(
			'@show ada/uniform/furious center\n@cg cg-window\nada: 窗外下雨了。 #0010',
		)
		expect((await project.read(projectFiles.chapter(chapter))).cg).toEqual([
			{ id: 'cg-window', description: 'Ada 在教室窗前' },
		])
		expect(jobs.map(({ assetId }) => assetId)).toEqual([
			'room/day',
			'room/rain',
			'ada/uniform/neutral',
			'ada/uniform/angry',
			'cg-window',
			'ada/coat/neutral',
		])
		expect(results).toEqual(jobs.map(() => ({ status: 'drawn' })))
		const { entries } = await art.registry()
		const profiles = await readProfiles(project)
		for (const entry of entries.filter(({ id }) => id.startsWith('room/')))
			expect(profiles[entry.path]?.profile).toEqual({
				mode: 'off',
				tier: 'anime',
			})
		const stagedCostume = manifest.script.replace(
			'@show ada/coat/neutral center',
			'@costume ada/coat',
		)
		const compiled = compileScript(stagedCostume, {
			assets: entries,
			speakers: ['ada'],
			paragraphIds: ['p0001'],
		})
		expect(
			compiled.ok &&
				compiled.scenes[0].beats
					.flatMap(({ actions }) => actions)
					.find(({ name }) => name === 'costume')?.assets,
		).toEqual([{ id: 'ada/coat/neutral' }])
		expect(
			entries.find((entry) => entry.id === 'ada/uniform/angry')?.aliases,
		).toEqual(['ada/uniform/furious'])
		for (const entry of entries) {
			const portrait = entry.type === 'character' || entry.type === 'expression'
			expect(entry.status).toBe('drawn')
			expect(
				await sharp(await project.readFile(entry.path)).metadata(),
			).toMatchObject({
				format: 'webp',
				width: portrait ? 2048 : 2560,
				height: portrait ? 3072 : 1440,
				hasAlpha: portrait,
			})
		}
		const noRecording = service(project, {
			...replay,
			directory: join(directory, 'absent'),
		})
		for (const job of jobs)
			expect(await noRecording.draw(job, confirmed)).toEqual({
				status: 'drawn',
			})
	})
}, 45_000)

test('bounds chapter review quotes without shrinking generation references or saved images', async () => {
	const render = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async (_prompt, refs, size) => {
			expect(await sharp(refs[0]).metadata()).toMatchObject({
				width: 3840,
				height: 2160,
			})
			return { bytes: await picture(size.width, size.height, false) }
		})
	const postprocess = vi
		.spyOn(upscale, 'postprocess')
		.mockImplementation(async (image, { target, fit }) =>
			sharp(image)
				.resize({ ...target, fit })
				.png()
				.toBuffer(),
		)
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(
			async (_connection, prompt, _schema, _options, images) => {
				if (!prompt.startsWith('Visually audit')) return { content: '窗光' }
				expect(await sharp(images?.[0]).metadata()).toMatchObject({
					width: 1536,
					height: 864,
				})
				expect(await sharp(images?.[1]).metadata()).toMatchObject({
					width: 1536,
					height: 864,
				})
				const quote = await quoteSpend(
					new Request('https://example.invalid/v1/chat/completions', {
						method: 'POST',
						body: JSON.stringify({
							max_tokens: 4096,
							messages: [
								{
									role: 'user',
									content: [
										{ type: 'text', text: prompt },
										...(images ?? []).map((image) => ({
											type: 'image_url',
											image_url: {
												url: `data:image/png;base64,${image.toString('base64')}`,
											},
										})),
									],
								},
							],
						}),
					}),
				)
				expect(quote.tokens).toBeGreaterThan(2 * 53_248)
				expect(quote.tokens).toBeLessThan(120_000)
				return { pass: true, failedChecks: [], feedback: '' }
			},
		)
	try {
		await projectTest(async (project) => {
			const path = 'assets/style/reference.png'
			const original = await picture(3840, 2160, false)
			await project.writeFile(path, original)
			const art = new ArtProduction(project, {
				replay,
				main,
				fast: main,
				visual: main,
				image: {
					baseUrl: main.baseUrl,
					apiKey: main.apiKey,
					model: 'fixture-art-image',
					nativeMaxEdge: 2048,
					concurrency: 1,
					retries: 0,
					quality: 'medium',
					postProcess: 'single',
					upscaleTier: 'anime',
				},
			})
			const confirmed = {
				...bible,
				style: {
					...bible.style,
					status: 'confirmed' as const,
					references: [{ path, description: 'Style' }],
				},
			}
			const [job] = await art.register(
				[{ id: 'cg-window', kind: 'cg', description: 'A window' }],
				confirmed,
			)
			expect(await art.draw(job, confirmed)).toEqual({ status: 'drawn' })
			expect(postprocess).toHaveBeenCalledTimes(1)
			expect(
				await sharp(postprocess.mock.calls[0][0]).metadata(),
			).toMatchObject({ width: 2048, height: 1152 })
			const entry = (await art.registry()).entries.find(
				(entry) => entry.id === job.assetId,
			)
			const profiles = await readProfiles(project)
			expect(entry && profiles[entry.path]?.profile).toEqual({
				mode: 'single',
				tier: 'anime',
			})
			expect(await project.readFile(path)).toEqual(original)
			expect(
				model.mock.calls.filter(([, prompt]) =>
					prompt.startsWith('Visually audit'),
				),
			).toHaveLength(1)
		})
	} finally {
		render.mockRestore()
		model.mockRestore()
		postprocess.mockRestore()
	}
}, 30_000)

test('preserves audited art when the local upscaler is unavailable', async () => {
	const render = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async (_prompt, _refs, size, alpha) => ({
			bytes: await picture(size.width, size.height, alpha),
		}))
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) =>
			prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: '窗光' },
		)
	try {
		await projectTest(async (project) => {
			vi.stubEnv('NL_UPSCALE_DIR', join(project.root, 'missing-upscaler'))
			const art = service(project, replay, undefined, undefined, {
				mode: 'single',
				tier: 'fast',
			})
			const jobs = await art.register(
				[
					{ id: 'room/day', kind: 'location', description: 'Sunny' },
					{ id: 'room/rain', kind: 'variant', description: 'Rainy' },
				],
				bible,
			)
			for (const job of jobs)
				expect(await art.draw(job, bible)).toEqual({ status: 'drawn' })
			const profiles = await readProfiles(project)
			for (const entry of (await art.registry()).entries) {
				expect(entry.status).toBe('drawn')
				expect(profiles[entry.path]?.profile).toEqual({
					mode: 'off',
					tier: 'fast',
				})
			}
		})
	} finally {
		vi.unstubAllEnvs()
		render.mockRestore()
		model.mockRestore()
	}
})

test('candidates retain their applied profile and base redraws keep existing variants compatible', async () => {
	const render = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async (_prompt, _refs, size, alpha) => ({
			bytes: await picture(size.width, size.height, alpha),
		}))
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) =>
			prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: '窗光' },
		)
	const postprocess = vi
		.spyOn(upscale, 'postprocess')
		.mockImplementation(async (image, { target, fit }) =>
			sharp(image)
				.resize({ ...target, fit })
				.png()
				.toBuffer(),
		)
	try {
		await projectTest(async (project) => {
			const profile = { mode: 'single', tier: 'fast' } as const
			const art = service(project, replay, undefined, undefined, profile)
			const imported = 'assets/imported.png'
			await project.writeFile(imported, await picture(32, 24, false))
			const pool = await art.candidates(bible, ['c1'], imported, [
				{ id: 'imported', cachePath: imported },
			])
			expect(postprocess).toHaveBeenCalledTimes(5)
			const portrait = pool.characters[0].candidates[0]
			const records = await readProfiles(project)
			expect(records[portrait.cachePath]?.profile).toEqual(profile)
			expect(records[pool.mainVisuals[1].cachePath]?.profile).toEqual(profile)
			expect(records[imported]).toBeUndefined()

			const changed = service(project, replay, undefined, undefined, {
				mode: 'double',
				tier: 'detail',
			})
			const style = await changed.confirmVisual(bible.style, pool, {
				mainVisualId: pool.mainVisuals[1].id,
				supplementalIds: ['imported'],
				characters: [
					{
						characterId: 'ada',
						costumeId: 'uniform',
						candidateId: portrait.id,
					},
				],
			})
			expect(postprocess).toHaveBeenCalledTimes(5)
			const baseId = 'ada/uniform/neutral'
			const profiles = await readProfiles(project)
			expect(profiles[style.references?.[0].path ?? '']?.profile).toEqual(
				profile,
			)
			expect(profiles[style.references?.[1].path ?? '']?.profile).toEqual({
				mode: 'off',
				tier: 'detail',
			})
			const [base, variant] = await changed.register(
				[
					{
						id: 'ada/uniform/angry',
						kind: 'expression',
						description: '眉毛压低',
					},
				],
				bible,
			)
			expect(base.assetId).toBe(baseId)
			expect(await changed.draw(variant, bible)).toEqual({ status: 'drawn' })
			const path = 'candidates/redraw.webp'
			expect(await changed.redraw(base, bible, undefined, { path })).toEqual({
				status: 'drawn',
			})
			const adopted = await changed.adopt(baseId, path)
			const after = await readProfiles(project)
			expect(after[adopted]?.profile).toEqual(profile)
			const variantPath =
				(await changed.registry()).entries.find(
					({ id }) => id === variant.assetId,
				)?.path ?? ''
			expect(after[variantPath]?.profile).toEqual(profile)
			expect(postprocess).toHaveBeenCalledTimes(7)
			for (const [, options] of postprocess.mock.calls)
				expect(options).toMatchObject(profile)
			await expect(changed.adopt(baseId, imported)).rejects.toThrow(
				'差分后处理档位与基准不一致',
			)
		})
	} finally {
		postprocess.mockRestore()
		render.mockRestore()
		model.mockRestore()
	}
}, 45_000)

test('uses three WebP placeholder families, but preserves pending status for unsupported capabilities', async () => {
	await projectTest(async (project) => {
		const { art, results } = await runFailures(project, replay)
		expect(results).toEqual([
			{ status: 'placeholder', issue: '图片无法解码。' },
			{ status: 'placeholder', issue: '图片无法解码。' },
			{ status: 'placeholder', issue: '发卡缺失' },
			{ status: 'unsupported', issue: expect.stringContaining('能力不支持') },
			{ status: 'placeholder', issue: expect.stringContaining('内容审核拒绝') },
		])
		const { entries } = await art.registry()
		const placeholders = []
		for (const entry of entries.slice(0, 3)) {
			expect(entry.status).toBe('placeholder')
			const bytes = await project.readFile(entry.path)
			placeholders.push(bytes)
			expect(await sharp(bytes).metadata()).toMatchObject({
				format: 'webp',
				hasAlpha: entry.type === 'character',
				width: entry.type === 'character' ? 1024 : 1920,
				height: entry.type === 'character' ? 1536 : 1080,
			})
		}
		expect(placeholders[1].equals(placeholders[2])).toBe(false)
		expect(entries[3].status).toBe('pending')
		await expect(project.readFile(entries[3].path)).rejects.toMatchObject({
			code: 'ENOENT',
		})
	})
}, 30_000)

test('missing strict cassettes fail closed, not as asset placeholders', async () => {
	await projectTest(async (project) => {
		const art = service(project, {
			...replay,
			directory: join(directory, 'absent'),
		})
		const [job] = await art.register(
			[{ id: 'cg-absent', kind: 'cg', description: '无回放' }],
			bible,
		)
		await expect(art.draw(job, bible)).rejects.toThrow(
			'Missing strict replay cassette',
		)
		expect((await art.registry()).entries[0].status).toBe('pending')
	})
})

test('a moderation rewrite does not consume the technical redraw budget', async () => {
	const render = vi
		.fn<ReturnType<typeof artModels.imageRenderer>>()
		.mockResolvedValueOnce({
			error: { code: 'moderation', message: '内容审核拒绝' },
		})
		.mockResolvedValueOnce({ bytes: Buffer.from('not an image') })
		.mockImplementationOnce(async (_prompt, _refs, size, alpha) => ({
			bytes: await picture(size.width, size.height, alpha),
		}))
	const renderer = vi.spyOn(artModels, 'imageRenderer').mockReturnValue(render)
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) =>
			prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: '柔和的窗光' },
		)
	try {
		await projectTest(async (project) => {
			const art = service(project, replay)
			const [job] = await art.register(
				[{ id: 'cg-moderated-redraw', kind: 'cg', description: '窗边' }],
				bible,
			)
			expect(await art.draw(job, bible)).toEqual({ status: 'drawn' })
			expect(render).toHaveBeenCalledTimes(3)
			expect(render.mock.calls[1][0]).toContain('请收敛描写')
			expect(render.mock.calls[2][0]).toContain('图片无法解码')
		})
	} finally {
		renderer.mockRestore()
		model.mockRestore()
	}
})

test('rejects mismatched derivation sizes and RGB transparency, not legitimate RGBA PNG sprites', async () => {
	const target = { width: 64, height: 96 }
	const png = await picture(64, 96, true)
	expect(
		await checkImage(png, target, { transparent: true, variant: false }),
	).toHaveProperty('png')
	expect(
		await checkImage(await picture(64, 96, false), target, {
			transparent: true,
			variant: false,
		}),
	).toMatchObject({ unsupported: true })
	expect(
		await checkImage(await picture(32, 48, true), target, {
			transparent: true,
			variant: false,
			base: png,
		}),
	).toEqual({ issue: '差分图尺寸与基准图不一致。' })
})

test('restores a narrow expression crown without accepting clipped bases or shifted edits', async () => {
	const target = { width: 400, height: 600 }
	const sprite = (crown: string, join = 'M199 3h2v4h-2Z') =>
		sharp(
			Buffer.from(
				`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><path fill="#259" d="${crown} ${join} M201 7Q310 80 285 215L350 600H50l65-385Q90 80 199 7Z"/></svg>`,
			),
		)
			.png()
			.toBuffer()
	const base = await sprite('M199 1h2v2h-2Z')
	const drift = await sprite('M199 0h2v3h-2Z')
	const clipped = await sprite('M175 0h50v3h-50Z')
	const misalignedSeam = await sprite('M199 0h2v3h-2Z', 'M207 3h2v4h-2Z')
	const disconnectedTip = await sprite('M194 1h2v1h-2Z M199 1h2v2h-2Z')
	const checks = { transparent: true, variant: false }
	const fixed = await checkImage(drift, target, { ...checks, base })
	expect(fixed).toHaveProperty('png')
	if ('png' in fixed) {
		const raw = (input: Buffer) => sharp(input).raw().toBuffer()
		expect((await raw(fixed.png)).subarray(0, 400 * 4 * 3)).toEqual(
			(await raw(base)).subarray(0, 400 * 4 * 3),
		)
	}
	const flaredHair = 'M193 3h14v4h-14Z'
	const hairBase = await sprite('M199 1h2v1l5 1h-12l5-1Z', flaredHair)
	const hairEdit = await sprite('M199 0h2v2l5 1h-12l5-1Z', flaredHair)
	expect(
		await checkImage(hairEdit, target, { ...checks, base: hairBase }),
	).toHaveProperty('png')
	for (const [input, reference] of [
		[drift, undefined],
		[clipped, base],
		[misalignedSeam, base],
		[drift, disconnectedTip],
	] as const) {
		expect(
			await checkImage(input, target, { ...checks, base: reference }),
		).toEqual({
			issue: '立绘主体缺失，或头部、侧面超出画布。',
		})
	}
})

test.each([
	{
		name: 'reference-only style advice does not block',
		appearance: undefined,
		verdict: { pass: true, failedChecks: [], feedback: '' },
		status: 'drawn',
	},
	{
		name: 'a mismatch against written style still blocks',
		appearance: { description: ' ' },
		verdict: {
			pass: false,
			failedChecks: ['style'],
			feedback: 'Use thicker black contours.',
		},
		status: 'placeholder',
	},
])(
	'shares a fallback base-sprite brief when $name',
	async ({ appearance, verdict, status }) => {
		const description = 'A red fox with a white-tipped tail.'
		const style = 'Thick black contours with flat shading.'
		const render = vi
			.fn<ReturnType<typeof artModels.imageRenderer>>()
			.mockImplementation(async (_prompt, _refs, { width, height }) => ({
				bytes: await picture(width, height, true),
			}))
		const renderer = vi
			.spyOn(artModels, 'imageRenderer')
			.mockReturnValue(render)
		const textCalls: { prompt: string; images: number }[] = []
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init)
			const { messages } = await request.json()
			const parts = messages[0].content
			const prompt: string = typeof parts === 'string' ? parts : parts[0].text
			const images = typeof parts === 'string' ? 0 : parts.length - 1
			textCalls.push({ prompt, images })
			const response = images
				? {
						...verdict,
						styleReferenceFeedback: 'The reference uses a cool palette.',
					}
				: { content: 'The subject looks up.' }
			const chunk = {
				choices: [
					{
						index: 0,
						delta: { content: JSON.stringify(response) },
						finish_reason: 'stop',
					},
				],
			}
			return new Response(
				`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
				{
					headers: { 'content-type': 'text/event-stream' },
				},
			)
		}
		try {
			await projectTest(async (project) => {
				const path = 'assets/style.png'
				await project.writeFile(path, await picture(320, 180, false))
				const [ada] = bible.characters
				const styled = {
					...bible,
					characters: [
						{
							...ada,
							description,
							appearance,
							costumes: undefined,
							references: undefined,
						},
					],
					style: {
						...bible.style,
						description: style,
						references: [{ path, description: 'Style' }],
					},
				}
				const art = service(
					project,
					{ ...replay, mode: 'replay', fetch },
					undefined,
					undefined,
					undefined,
					0,
				)
				const [base] = await art.register(
					[{ id: 'ada/uniform/neutral', kind: 'character', description: '' }],
					styled,
				)
				expect((await art.draw(base, styled)).status).toBe(status)
				expect(render).toHaveBeenCalledTimes(1)
				expect(render.mock.calls[0][0]).toContain(description)
				expect(render.mock.calls[0][0]).toContain(style)
				expect(render.mock.calls[0][1]).toEqual([])
				expect(textCalls).toHaveLength(2)
				expect(textCalls[0].prompt).toContain(`character: ${description}`)
				expect(textCalls[1].prompt).toContain(
					`Original image brief (verify independently of the painter's rewrite): ${description}`,
				)
				expect(textCalls[1].prompt).toContain(
					`Judge the blocking style check only against this written style description: ${style}`,
				)
				expect(textCalls[1].prompt).toContain(
					'must not affect pass, failedChecks, or blocking feedback',
				)
				expect(textCalls[1].prompt).not.toContain('Match how it is drawn')
				expect(textCalls[1].images).toBe(2)
			})
		} finally {
			renderer.mockRestore()
		}
	},
)

test('an expression uses only the base and retries composition and blocking audit failures', async () => {
	const render = vi
		.fn<ReturnType<typeof artModels.imageRenderer>>()
		.mockImplementation(async (_prompt, _refs, { width, height }) => ({
			bytes:
				render.mock.calls.length === 2
					? await sharp(
							Buffer.from(
								`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width / 2}" height="${height}" fill="#456def"/></svg>`,
							),
						)
							.png()
							.toBuffer()
					: await picture(width, height, true),
		}))
	const renderer = vi.spyOn(artModels, 'imageRenderer').mockReturnValue(render)
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) => {
			if (prompt.startsWith('Visually audit') && render.mock.calls.length === 3)
				return {
					pass: false,
					failedChecks: ['anchors', 'description'],
					feedback: 'Keep the eyes aligned and raise the brows.',
				}
			return prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: 'Ada raises her eyebrows.' }
		})
	try {
		await projectTest(async (project) => {
			const art = service(project, replay, undefined, undefined, undefined, 2)
			const path = 'assets/style.png'
			await project.writeFile(path, await picture(320, 180, false))
			const styled = {
				...bible,
				characters: bible.characters.map((character) => ({
					...character,
					description: 'Ada is a red fox with a cream muzzle.',
					appearance: undefined,
				})),
				style: { ...bible.style, references: [{ path, description: 'Style' }] },
			}
			const [base, expression] = await art.register(
				[
					{ id: 'ada/uniform/neutral', kind: 'character', description: 'Ada' },
					{
						id: 'ada/uniform/curious',
						kind: 'expression',
						description: 'Curious',
					},
				],
				styled,
			)
			expect(await art.draw(base, styled)).toEqual({ status: 'drawn' })
			expect(render.mock.calls[0][1]).toEqual([])
			expect(render.mock.calls[0][0]).toContain(styled.style.description)
			const audit = model.mock.calls.find(([, prompt]) =>
				prompt.startsWith('Visually audit'),
			)
			expect(audit?.[1]).toContain('Image 2 is a style reference only.')
			expect(audit?.[1]).toContain(
				'Describe style differences and concrete corrections in words; do not refer to reference images by number.',
			)
			expect(audit?.[4]?.slice(1)).toEqual([await project.readFile(path)])
			expect(await art.draw(expression, styled)).toEqual({ status: 'drawn' })
			expect(render).toHaveBeenCalledTimes(4)
			expect(render.mock.calls[1][1]).toHaveLength(1)
			expect(render.mock.calls[2][1]).toEqual([render.mock.calls[1][1][0]])
			expect(render.mock.calls[3][1]).toEqual(render.mock.calls[1][1])
			expect(render.mock.calls[2][0]).toContain(
				'pixel-aligned outside the face',
			)
			expect(render.mock.calls[3][0]).toContain(
				'Keep the eyes aligned and raise the brows.',
			)
			expect(render.mock.calls[1][0]).toContain('Expression cue: Curious')
			expect(render.mock.calls[1][0]).toContain(
				'Preserve: Ada is a red fox with a cream muzzle.',
			)
			expect(render.mock.calls[1][0]).toContain('蓝色制服')
			expect(render.mock.calls[1][0]).not.toContain(styled.style.description)
			const expressionPainter = model.mock.calls.filter(([, prompt]) =>
				prompt.includes('expression: Curious'),
			)
			expect(expressionPainter).toHaveLength(3)
			expect(expressionPainter[0][1]).toContain(
				'Character preservation context (not part of the expression cue): Ada is a red fox with a cream muzzle.',
			)
			const expressionAudits = model.mock.calls.filter(([, prompt]) =>
				prompt.includes('Image 2 is the accepted base.'),
			)
			expect(expressionAudits).toHaveLength(2)
			for (const [, prompt, , , images] of expressionAudits) {
				expect(prompt).toContain('saved cue (description)')
				expect(prompt).toContain('anchors and key colors against the base')
				expect(prompt).toContain('Judge style only by preservation')
				expect(prompt).toContain(
					"Original image brief (verify independently of the painter's rewrite): Curious",
				)
				expect(prompt).toContain(
					'Character preservation context: Ada is a red fox with a cream muzzle.',
				)
				expect(prompt).not.toContain(styled.style.description)
				expect(images).toHaveLength(2)
				expect(images?.slice(1)).toEqual(render.mock.calls[1][1])
			}
		})
	} finally {
		renderer.mockRestore()
		model.mockRestore()
	}
})

test('removes an opaque sprite background before validating and auditing the result', async () => {
	const svg = Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><path fill="#e8dfd7" d="M0 0h300v450H0z"/><ellipse fill="#3d2536" cx="150" cy="122" rx="49" ry="63"/><ellipse fill="#e1a07f" cx="150" cy="126" rx="36" ry="48"/><path fill="#5230a0" d="M112 175q-44 12-51 81l18 92 22-14 2 116h94l2-116 22 14 18-92q-7-69-51-81z"/></svg>',
	)
	const opaque = await sharp(svg).removeAlpha().png().toBuffer()
	const landscape = await picture(320, 180, false)
	let nativeCandidate = false
	const render = vi
		.fn<ReturnType<typeof artModels.imageRenderer>>()
		.mockImplementation(
			async (prompt, refs, { width, height }, transparent) => ({
				bytes: !transparent
					? landscape
					: nativeCandidate &&
							(refs.length
								? prompt.includes('银色外套')
								: prompt.includes('造型候选 1'))
						? await picture(width, height, true)
						: opaque,
			}),
		)
	const renderer = vi.spyOn(artModels, 'imageRenderer').mockReturnValue(render)
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(
			async (_connection, prompt, _schema, _options, images) => {
				if (!prompt.startsWith('Visually audit'))
					return {
						content: prompt.includes('银色外套')
							? '银色外套'
							: prompt.includes('造型候选 1')
								? '造型候选 1'
								: 'Ada',
					}
				const { data, info } = await sharp(images?.[0])
					.raw()
					.toBuffer({ resolveWithObject: true })
				if (info.height > info.width) {
					expect(prompt).toContain('checkerboard in Image 1 shows transparency')
					expect(info.channels).toBe(3)
					expect([...data.subarray(0, 3)]).toEqual([170, 170, 170])
					const tile = Math.round(info.width / 24)
					expect([...data.subarray(tile * 3, (tile + 1) * 3)]).toEqual([
						221, 221, 221,
					])
					const center =
						Math.floor(info.height / 2) * info.width +
						Math.floor(info.width / 2)
					expect(data[center * 3]).not.toBe(data[center * 3 + 1])
				} else {
					expect(prompt).not.toContain('checkerboard')
				}
				return { pass: true, failedChecks: [], feedback: '' }
			},
		)
	try {
		await projectTest(async (project) => {
			const art = service(project, replay)
			const [ada] = bible.characters
			const twoCostumes = {
				...bible,
				characters: [
					{
						...ada,
						costumes: [
							...(ada.costumes ?? []),
							{ id: 'coat', description: '外套' },
						],
					},
				],
			}
			const portraitRequests = () =>
				render.mock.calls.filter(([, , , portrait]) => portrait)
			vi.stubEnv('NL_MATTING_DIR', join(project.root, 'missing-matting'))
			const pool = await art.candidates(
				twoCostumes,
				['c1'],
				'assets/main.webp',
				[],
			)
			expect(pool).toMatchObject({ mattingUnavailable: true, characters: [] })
			expect(portraitRequests()).toHaveLength(2)
			const illustration = 'source/references/illustration-1.png'
			await project.writeFile(illustration, landscape)
			render.mockClear()
			nativeCandidate = true
			const withIllustration = await art.candidates(
				{
					...twoCostumes,
					characters: [
						...twoCostumes.characters,
						{
							...ada,
							id: 'bea',
							name: 'Bea',
							costumes: [{ id: 'jacket', description: '银色外套' }],
						},
					],
				},
				['c1'],
				'assets/main.webp',
				[],
				new Map(
					['ada', 'bea'].map((id) => [
						id,
						{ id: 'illustration-1', cachePath: illustration },
					]),
				),
			)
			expect(withIllustration).toMatchObject({
				mattingUnavailable: true,
				characters: [
					{ costumeId: 'uniform', candidates: [{ id: 'costume-1' }] },
					{
						characterId: 'bea',
						costumeId: 'jacket',
						candidates: [{ id: 'costume-epub' }],
					},
				],
			})
			expect(portraitRequests().map(([, refs]) => refs.length)).toEqual([
				1, 0, 0, 0, 1, 1, 0, 0,
			])
			nativeCandidate = false
			const [fallback] = await art.register(
				[{ id: 'ada/coat/neutral', kind: 'character', description: 'Ada' }],
				bible,
			)
			await expect(art.draw(fallback, bible)).resolves.toEqual({
				status: 'placeholder',
				reason: 'matting_unavailable',
				issue: '本地去背景不可用；请使用可返回透明底的图片模型。',
			})
			const registry = await art.registry()
			const saved = registry.entries.find(({ id }) => id === fallback.assetId)
			if (!saved) throw new Error('Missing registered sprite')
			expect(saved?.status).toBe('placeholder')
			expect(
				await sharp(await project.readFile(saved.path)).metadata(),
			).toMatchObject({
				format: 'webp',
				hasAlpha: true,
			})
			vi.unstubAllEnvs()
			const [sprite] = await art.register(
				[{ id: 'ada/uniform/neutral', kind: 'character', description: 'Ada' }],
				bible,
			)
			expect(await art.draw(sprite, bible)).toEqual({ status: 'drawn' })
			const drawn = (await art.registry()).entries.find(
				({ id }) => id === sprite.assetId,
			)
			if (!drawn) throw new Error('Missing drawn sprite')
			const { data } = await sharp(await project.readFile(drawn.path))
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true })
			expect(data[3]).toBe(0)
		})
	} finally {
		vi.unstubAllEnvs()
		renderer.mockRestore()
		model.mockRestore()
	}
}, 15_000)

test('an opaque RGBA response counts toward the unavailable-matting candidate limit', async () => {
	const rgb = await picture(320, 480, false)
	const rgba = await sharp(rgb).ensureAlpha().png().toBuffer()
	const landscape = await picture(320, 180, false)
	let portraits = 0
	const matte = vi
		.spyOn(background, 'removeBackground')
		.mockRejectedValue(new background.MattingUnavailableError(undefined))
	const renderer = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(
			async (_prompt, _refs, { width, height }, transparent) => ({
				bytes: !transparent
					? landscape
					: ++portraits === 1
						? rgb
						: portraits === 2
							? rgba
							: await picture(width, height, true),
			}),
		)
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) =>
			prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: 'Ada' },
		)
	try {
		await projectTest(async (project) => {
			const pool = await service(project, replay).candidates(
				bible,
				['c1'],
				'assets/main.webp',
			)
			expect(pool).toMatchObject({ mattingUnavailable: true, characters: [] })
			expect(portraits).toBe(2)
		})
	} finally {
		matte.mockRestore()
		renderer.mockRestore()
		model.mockRestore()
	}
})

test('skips an isolated opaque RGBA candidate when matting is unavailable and retries are off', async () => {
	const rgb = await picture(320, 480, false)
	const rgba = await sharp(rgb).ensureAlpha().png().toBuffer()
	const landscape = await picture(320, 180, false)
	const portrait = await picture(320, 480, true)
	const responses = [rgb, rgb, rgba, portrait, portrait]
	const render = vi
		.fn<ReturnType<typeof artModels.imageRenderer>>()
		.mockImplementation(async (_prompt, _refs, _size, transparent) => {
			const bytes = transparent ? responses.shift() : landscape
			if (!bytes) throw new Error('Unexpected extra portrait request')
			return { bytes }
		})
	const matte = vi
		.spyOn(background, 'removeBackground')
		.mockRejectedValue(new background.MattingUnavailableError(undefined))
	const renderer = vi.spyOn(artModels, 'imageRenderer').mockReturnValue(render)
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) =>
			prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: 'Ada' },
		)
	try {
		await projectTest(async (project) => {
			const art = service(project, replay, undefined, undefined, undefined, 0)
			const [ada] = bible.characters
			const pool = await art.candidates(
				{ ...bible, characters: [ada, { ...ada, id: 'bea', name: 'Bea' }] },
				['c1'],
				'assets/main.webp',
			)
			expect(pool).toMatchObject({
				mattingUnavailable: true,
				characters: [
					{
						characterId: 'bea',
						candidates: [{ id: 'costume-2' }, { id: 'costume-3' }],
					},
				],
			})
			expect(responses).toHaveLength(0)
		})
	} finally {
		matte.mockRestore()
		renderer.mockRestore()
		model.mockRestore()
	}
})

test('style-only sprite candidates do not share the opaque-edit cutoff', async () => {
	const opaque = await picture(320, 480, false)
	const landscape = await picture(320, 180, false)
	const portrait = await picture(320, 480, true)
	const portraitReferences: number[] = []
	const renderer = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async (_prompt, refs, _size, transparent) => {
			if (!transparent) return { bytes: landscape }
			portraitReferences.push(refs.length)
			return {
				bytes:
					refs.length || portraitReferences.length === 2 ? opaque : portrait,
			}
		})
	const matte = vi
		.spyOn(background, 'removeBackground')
		.mockRejectedValue(new background.MattingUnavailableError(undefined))
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) =>
			prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: 'Ada' },
		)
	try {
		await projectTest(async (project) => {
			const art = service(project, replay, undefined, undefined, undefined, 0)
			const path = 'assets/style.png'
			const illustration = 'source/references/illustration.png'
			await project.writeFile(path, landscape)
			await project.writeFile(illustration, landscape)
			const [ada] = bible.characters
			const pool = await art.candidates(
				{
					...bible,
					style: {
						...bible.style,
						references: [{ path, description: 'Style' }],
					},
					characters: [
						{
							...ada,
							costumes: [
								...(ada.costumes ?? []),
								{ id: 'coat', description: 'Coat' },
							],
						},
					],
				},
				['c1'],
				'assets/main.webp',
				[],
				new Map([['ada', { id: 'illustration', cachePath: illustration }]]),
			)
			expect(portraitReferences).toEqual([2, 0, 0, 0, 2, 0, 0, 0])
			expect(pool).toMatchObject({
				mattingUnavailable: true,
				characters: [
					{
						costumeId: 'uniform',
						candidates: [{ id: 'costume-2' }, { id: 'costume-3' }],
					},
					{
						costumeId: 'coat',
						candidates: [
							{ id: 'costume-1' },
							{ id: 'costume-2' },
							{ id: 'costume-3' },
						],
					},
				],
			})
		})
	} finally {
		renderer.mockRestore()
		matte.mockRestore()
		model.mockRestore()
	}
}, 15_000)

test('keeps a reviewed transparent fallback when later opaque responses exhaust the budget', async () => {
	const rgb = await picture(320, 480, false)
	const rgba = await sharp(rgb).ensureAlpha().png().toBuffer()
	const landscape = await picture(320, 180, false)
	const portrait = await picture(320, 480, true)
	const responses = [rgb, rgb, portrait, rgba, rgba]
	const matte = vi
		.spyOn(background, 'removeBackground')
		.mockRejectedValue(new background.MattingUnavailableError(undefined))
	const renderer = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async (_prompt, _refs, _size, transparent) => {
			const bytes = transparent ? responses.shift() : landscape
			if (!bytes) throw new Error('Unexpected extra portrait request')
			return { bytes }
		})
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) => {
			if (!prompt.startsWith('Visually audit')) return { content: 'Ada' }
			return prompt.includes('造型候选')
				? {
						pass: false,
						failedChecks: ['style'],
						feedback: 'Try another style',
					}
				: { pass: true, failedChecks: [], feedback: '' }
		})
	try {
		await projectTest(async (project) => {
			const art = service(project, replay, undefined, undefined, undefined, 2)
			const [ada] = bible.characters
			const pool = await art.candidates(
				{ ...bible, characters: [ada, { ...ada, id: 'bea', name: 'Bea' }] },
				['c1'],
				'assets/main.webp',
			)
			expect(pool).toMatchObject({
				mattingUnavailable: true,
				characters: [{ characterId: 'bea', candidates: [{ id: 'costume-1' }] }],
			})
			const { cachePath } = pool.characters[0].candidates[0]
			const alpha = await sharp(await project.readFile(cachePath))
				.extractChannel('alpha')
				.raw()
				.toBuffer()
			expect(alpha.includes(0)).toBe(true)
			expect(responses).toHaveLength(0)
		})
	} finally {
		matte.mockRestore()
		renderer.mockRestore()
		model.mockRestore()
	}
})

test('retries after an unmattable image instead of immediately offering a rejected fallback', async () => {
	const opaque = await picture(320, 480, false)
	const landscape = await picture(320, 180, false)
	const portrait = await picture(320, 480, true)
	const approved = await sharp(portrait)
		.negate({ alpha: false })
		.png()
		.toBuffer()
	const responses = [portrait, opaque, approved, opaque, opaque]
	const portraitPrompts: string[] = []
	let portraitReviews = 0
	const matte = vi
		.spyOn(background, 'removeBackground')
		.mockRejectedValue(new background.MattingUnavailableError(undefined))
	const renderer = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async (prompt, _refs, _size, transparent) => {
			if (transparent) portraitPrompts.push(prompt)
			const bytes = transparent ? responses.shift() : landscape
			if (!bytes) throw new Error('Unexpected extra portrait request')
			return { bytes }
		})
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) => {
			if (!prompt.startsWith('Visually audit')) return { content: 'Ada' }
			return prompt.includes('造型候选') && ++portraitReviews === 1
				? {
						pass: false,
						failedChecks: ['style'],
						feedback: 'Try another style',
					}
				: { pass: true, failedChecks: [], feedback: '' }
		})
	try {
		await projectTest(async (project) => {
			const art = service(project, replay, undefined, undefined, undefined, 2)
			const pool = await art.candidates(bible, ['c1'], 'assets/main.webp')
			expect(pool).toMatchObject({
				mattingUnavailable: true,
				characters: [{ characterId: 'ada', candidates: [{ id: 'costume-1' }] }],
			})
			expect(portraitReviews).toBe(2)
			expect(portraitPrompts[1]).toContain('Try another style')
			expect(portraitPrompts[2]).toContain('Try another style')
			expect(responses).toHaveLength(0)
			const { cachePath } = pool.characters[0].candidates[0]
			const saved = sharp(await project.readFile(cachePath))
			const { width, height } = await saved.metadata()
			const pixel = await saved
				.extract({
					left: Math.floor(width / 2),
					top: Math.floor(height / 2),
					width: 1,
					height: 1,
				})
				.raw()
				.toBuffer()
			expect(pixel[0]).toBeGreaterThan(128)
		})
	} finally {
		matte.mockRestore()
		renderer.mockRestore()
		model.mockRestore()
	}
})

test.each([
	{ terminal: 'both repair prompts are moderated', first: 'costume-epub' },
	{ terminal: 'the repair reference is refused', first: 'costume-1' },
	{
		terminal: 'the plain replacement fails every technical check',
		first: 'costume-epub',
		replacementFails: true,
	},
])('offers $first after $terminal', async ({ first, replacementFails }) => {
	const opaque = await picture(320, 480, false)
	const landscape = await picture(320, 180, false)
	const portrait = await picture(320, 480, true)
	const moderated = {
		error: { code: 'moderation', message: 'Content rejected' },
	} as const
	const keepEpub = first === 'costume-epub'
	const blank = await sharp({
		create: {
			width: 320,
			height: 480,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.png()
		.toBuffer()
	const responses: Awaited<
		ReturnType<ReturnType<typeof artModels.imageRenderer>>
	>[] = [
		{ bytes: portrait },
		...(keepEpub
			? [{ bytes: opaque }, moderated, moderated]
			: [
					{ bytes: opaque },
					{ ...moderated, referenceModerated: true } as const,
					{ bytes: portrait },
				]),
		...(replacementFails
			? Array.from({ length: 3 }, () => ({ bytes: blank }))
			: []),
		{ bytes: opaque },
		{ bytes: opaque },
	]
	const render = vi
		.fn<ReturnType<typeof artModels.imageRenderer>>()
		.mockImplementation(async (_prompt, _refs, _size, transparent) => {
			const response = transparent ? responses.shift() : { bytes: landscape }
			if (!response) throw new Error('Unexpected extra portrait request')
			return response
		})
	const renderer = vi.spyOn(artModels, 'imageRenderer').mockReturnValue(render)
	const matte = vi
		.spyOn(background, 'removeBackground')
		.mockRejectedValue(new background.MattingUnavailableError(undefined))
	let portraitReviews = 0
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) => {
			if (!prompt.startsWith('Visually audit')) return { content: 'Ada' }
			return prompt.includes('造型候选') && ++portraitReviews === 1
				? {
						pass: false,
						failedChecks: ['style'],
						feedback: 'Try another style',
					}
				: { pass: true, failedChecks: [], feedback: '' }
		})
	try {
		await projectTest(async (project) => {
			const illustration = 'source/references/illustration-1.png'
			await project.writeFile(illustration, landscape)
			const art = service(project, replay, undefined, undefined, undefined, 2)
			const pool = await art.candidates(
				bible,
				['c1'],
				'assets/main.webp',
				[],
				new Map([['ada', { id: 'illustration-1', cachePath: illustration }]]),
			)
			expect(pool).toMatchObject({
				mattingUnavailable: true,
				characters: [{ characterId: 'ada', candidates: [{ id: first }] }],
			})
			expect(
				render.mock.calls
					.filter(([, , , transparent]) => transparent)
					.map(([, refs]) => refs.length),
			).toEqual([
				...(keepEpub ? [1, 1, 1, 1] : [1, 1, 1, 0]),
				...(replacementFails ? [0, 0, 0] : []),
				0,
				0,
			])
			expect(portraitReviews).toBe(keepEpub ? 1 : 2)
		})
	} finally {
		renderer.mockRestore()
		matte.mockRestore()
		model.mockRestore()
	}
})

test('offers all technically valid costume options after visual rejection when matting works', async () => {
	const opaque = await picture(320, 480, false)
	const portrait = await picture(320, 480, true)
	const landscape = await picture(320, 180, false)
	const matte = vi
		.spyOn(background, 'removeBackground')
		.mockResolvedValue(portrait)
	const renderer = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async (_prompt, _refs, _size, transparent) => ({
			bytes: transparent ? opaque : landscape,
		}))
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) => {
			if (!prompt.startsWith('Visually audit')) return { content: 'Ada' }
			return prompt.includes('造型候选')
				? {
						pass: false,
						failedChecks: ['style'],
						feedback: 'Try another style',
					}
				: { pass: true, failedChecks: [], feedback: '' }
		})
	try {
		await projectTest(async (project) => {
			const illustration = 'source/references/illustration-1.png'
			await project.writeFile(illustration, landscape)
			const art = service(project, replay, undefined, undefined, undefined, 0)
			const pool = await art.candidates(
				bible,
				['c1'],
				'assets/main.webp',
				[],
				new Map([['ada', { id: 'illustration-1', cachePath: illustration }]]),
			)
			expect(pool.mattingUnavailable).toBeUndefined()
			expect(pool.characters[0].candidates.map(({ id }) => id)).toEqual([
				'costume-epub',
				'costume-2',
				'costume-3',
			])
			expect(matte).toHaveBeenCalledTimes(3)
		})
	} finally {
		matte.mockRestore()
		renderer.mockRestore()
		model.mockRestore()
	}
}, 30_000)

test.each([
	...[
		'plain moderation',
		'plain moderation before a cached choice',
		'EPUB moderation',
		'EPUB reference refusal',
		'opaque budget',
		'matting unavailable',
		'technical retries',
		'EPUB provider unsupported',
	].flatMap((stop) => [false, true].map((retained) => ({ stop, retained }))),
	{ stop: 'EPUB approved before provider unsupported', retained: true },
])(
	'resolves $stop with retained=$retained',
	async ({ stop, retained }) => {
		const opaque = await picture(320, 480, false)
		const portrait = await picture(320, 480, true)
		const landscape = await picture(320, 180, false)
		const moderation = {
			error: { code: 'moderation', message: 'Refused' },
		} as const
		const invalid = { bytes: Buffer.from('invalid image') }
		const epub = stop.startsWith('EPUB')
		const approved = stop === 'EPUB approved before provider unsupported'
		const capabilityError = stop === 'EPUB provider unsupported' || approved
		const cached = stop.endsWith('cached choice')
		const opaqueResponse = { bytes: opaque }
		const unsupported = {
			error: { code: 'unsupported', message: 'Unsupported' },
		} as const
		const failures = {
			'plain moderation': [moderation, moderation],
			'plain moderation before a cached choice': [moderation, moderation],
			'EPUB moderation': [moderation, moderation],
			'EPUB reference refusal': [
				{ ...moderation, referenceModerated: true } as const,
			],
			'opaque budget': [opaqueResponse, opaqueResponse],
			'matting unavailable': [opaqueResponse],
			'technical retries': [invalid, invalid, invalid],
			'EPUB provider unsupported': [unsupported],
			'EPUB approved before provider unsupported': [unsupported],
		}
		const primary = failures[stop as keyof typeof failures]
		const pending = [
			...(retained && !cached ? [{ bytes: portrait }] : []),
			...primary,
		]
		let portraitRequests = 0
		let approvedReviews = 0
		const renderer = vi
			.spyOn(artModels, 'imageRenderer')
			.mockReturnValue(async (_prompt, refs, _size, transparent) => {
				if (!transparent) return { bytes: landscape }
				portraitRequests++
				if (capabilityError && !approved && !refs.length)
					return { bytes: portrait }
				return pending.shift() ?? opaqueResponse
			})
		const matte = vi
			.spyOn(background, 'removeBackground')
			.mockRejectedValue(new background.MattingUnavailableError(undefined))
		const model = vi
			.spyOn(artModels, 'artJson')
			.mockImplementation(async (_connection, prompt) => {
				if (!prompt.startsWith('Visually audit')) return { content: 'Ada' }
				if (approved && prompt.includes('造型候选')) {
					approvedReviews++
					return { pass: true, failedChecks: [], feedback: '' }
				}
				return prompt.includes('造型候选')
					? {
							pass: false,
							failedChecks: ['style'],
							feedback: 'Try another style',
						}
					: { pass: true, failedChecks: [], feedback: '' }
			})
		try {
			await projectTest(async (project) => {
				const illustration = 'source/references/illustration-1.png'
				if (epub) await project.writeFile(illustration, landscape)
				if (retained && cached)
					await project.writeFile(
						projectFiles
							.style({ level: 'series' })
							.path.replace(
								'bible/style.json',
								'candidates/characters/ada/uniform/costume-2.webp',
							),
						await sharp(portrait).webp().toBuffer(),
					)
				const art = service(
					project,
					replay,
					undefined,
					undefined,
					undefined,
					stop === 'matting unavailable' ? 1 : 2,
				)
				const pool = art.candidates(
					bible,
					['c1'],
					'assets/main.webp',
					[],
					epub
						? new Map([
								['ada', { id: 'illustration-1', cachePath: illustration }],
							])
						: undefined,
				)
				if (capabilityError) {
					await expect(pool).rejects.toThrow('Unsupported')
					expect(portraitRequests).toBe(retained ? 2 : 1)
					expect(approvedReviews).toBe(approved ? 1 : 0)
				} else if (retained) {
					const { characters } = await pool
					expect(characters).toMatchObject([
						{
							characterId: 'ada',
							candidates: [
								{
									id: epub
										? 'costume-epub'
										: cached
											? 'costume-2'
											: 'costume-1',
								},
							],
						},
					])
				} else if (
					epub ||
					stop === 'opaque budget' ||
					stop === 'matting unavailable'
				) {
					expect((await pool).characters).toEqual([])
				} else {
					const message =
						stop === 'technical retries' ? '图片无法解码。' : 'Refused'
					await expect(pool).rejects.toThrow(message)
				}
				expect(portraitRequests).toBeGreaterThanOrEqual(primary.length)
			})
		} finally {
			model.mockRestore()
			matte.mockRestore()
			renderer.mockRestore()
		}
	},
	30_000,
)

test('staging patches cannot replace writer dialogue', () => {
	expect(() => applyStagingPatch(script, 'PUT 4.=4:\n@bg room/day')).toThrow(
		'Invalid staging patch',
	)
})

test.each([2, 1])(
	'trims least-used CGs first, then variants and expressions, without dropping bases at budget %i',
	(limit) => {
		const source = `scene Room
source p0001

@bg room/rain
@show ada/uniform/furious center
@cg cg-z
@cg cg-a
@fg cg-popular
@cg cg-popular
@face ada/angry 0.5
ada: The rain. #0010
`
		const items: ManifestItem[] = [
			{ id: 'cg-z', kind: 'cg', description: 'Z' },
			{ id: 'cg-popular', kind: 'cg', description: 'Popular' },
			{ id: 'cg-a', kind: 'cg', description: 'A' },
			{ id: 'room/rain', kind: 'variant', description: 'Rain' },
			{ id: 'ada/uniform/furious', kind: 'expression', description: 'Furious' },
		]
		const compile = (script: string, registry = empty) =>
			compileScript(script, {
				assets: registry.entries,
				paragraphIds: ['p0001'],
				speakers: ['ada'],
			})
		const fit = trimStagingToBudget(
			{
				script: source,
				items,
				merges: { 'ada/uniform/furious': 'ada/uniform/angry' },
			},
			bible,
			empty,
			{ limit, previousBases: new Map(), reusedImages: new Set() },
			(script, registry) => {
				const result = compile(script, registry)
				return result.ok ? result.scenes : undefined
			},
		)
		if (limit === 1) {
			expect(fit).toBeUndefined()
			return
		}
		if (!fit) throw new Error('Expected a plan within the chapter budget')
		expect(fit.trimmed).toEqual([
			{ id: 'cg-a' },
			{ id: 'cg-z' },
			{ id: 'cg-popular' },
			{ id: 'room/rain', replacement: 'room/day' },
			{ id: 'ada/uniform/angry', replacement: 'ada/uniform/neutral' },
		])
		expect(fit.merges).toEqual({})
		expect(fit.items.map(({ id }) => id)).toEqual([
			'room/day',
			'ada/uniform/neutral',
		])
		expect(fit.script).toContain(
			'@bg room/day\n@show ada/uniform/neutral center',
		)
		expect(fit.script).toContain('@fg none\n@cg none\n@face ada/neutral 0.5')
		expect(fit.script).toContain('ada: The rain. #0010')
		const playable = compile(
			fit.script,
			planArt(fit.items, bible, empty, fit.merges).registry,
		)
		if (!playable.ok) throw new Error(JSON.stringify(playable.diagnostics))
		expect(playbackAssetIds(playable.scenes)).toEqual(
			new Set(['room/day', 'ada/uniform/neutral']),
		)
	},
)

test('trims only after the bounded staging repair is still over budget', async () => {
	const response = JSON.stringify({
		patch: 'PUT <4:\n@bg room/day\n@cg cg-window',
		items: [
			{ id: 'room/day', kind: 'location', description: 'Classroom' },
			{ id: 'cg-window', kind: 'cg', description: 'At the window' },
		],
		merges: {},
	})
	const fetch = artReplies(response, response)
	const staged = await directChapterArt(script, bible, empty, {
		main,
		replay: { ...replay, mode: 'replay', fetch },
		imageBudget: {
			limit: 1,
			paragraphIds: ['p0001'],
			speakers: ['ada'],
			previousBases: new Map(),
			reusedImages: new Set(),
		},
	})
	expect(fetch).toHaveBeenCalledTimes(2)
	const [input, init] = fetch.mock.calls[1]
	expect(
		JSON.stringify((await new Request(input, init).json()).messages),
	).toContain('Chapter needs 2 new provider images; budget is 1')
	expect(staged.trimmed).toEqual([{ id: 'cg-window' }])
	expect(staged.script).toContain('@bg room/day\n@cg none')
	expect(staged.items.map(({ id }) => id)).toEqual(['room/day'])
})

test.each([6, 5, 4, 3])(
	'folds costumes before scene-local backgrounds at budget %i',
	(limit) => {
		const source = `scene First
source p0001

@bg room/day
@bg garden/day
@bg hall/day
@bg hall/day
@show ada/wedding/neutral center
@costume ada/uniform
@face ada/uniform/neutral
@costume ada/wedding
@show ben/coats/neutral left
@cg cg-window
ada: One. #0010

scene Second
source p0002

@bg room/day
ada: Two. #0020

scene Third
source p0003

@bg hall/day
ada: Three. #0030
`
		const items: ManifestItem[] = [
			{ id: 'room/day', kind: 'location', description: 'Room' },
			{ id: 'garden/day', kind: 'location', description: 'Garden' },
			{ id: 'hall/day', kind: 'location', description: 'Hall' },
			{ id: 'ada/wedding/neutral', kind: 'character', description: 'Wedding' },
			{ id: 'ada/uniform/neutral', kind: 'character', description: 'Uniform' },
			{ id: 'ben/coats/neutral', kind: 'character', description: 'Coat' },
			{ id: 'cg-window', kind: 'cg', description: 'Window' },
		]
		const failure = vi.fn()
		const fit = trimStagingToBudget(
			{ script: source, items, merges: {} },
			bible,
			empty,
			{ limit, previousBases: new Map(), reusedImages: new Set() },
			(script, { entries }) => {
				const compiled = compileScript(script, {
					assets: entries,
					paragraphIds: ['p0001', 'p0002', 'p0003'],
					speakers: ['ada'],
				})
				return compiled.ok ? compiled.scenes : undefined
			},
			failure,
		)
		if (limit === 3) {
			expect(fit).toBeUndefined()
			expect(failure).toHaveBeenCalledWith(
				['room/day', 'hall/day', 'ada/uniform/neutral', 'ben/coats/neutral'],
				4,
			)
			return
		}
		expect(fit?.trimmed).toEqual([
			{ id: 'cg-window' },
			...(limit < 6
				? [{ id: 'ada/wedding/neutral', replacement: 'ada/uniform/neutral' }]
				: []),
			...(limit < 5 ? [{ id: 'garden/day', replacement: 'hall/day' }] : []),
		])
		expect(fit?.script).toContain('scene Second\nsource p0002\n\n@bg room/day')
		expect(fit?.script).toContain('@show ben/coats/neutral left')
		if (limit < 6) {
			expect(fit?.script).toContain('@show ada/uniform/neutral center')
			expect(fit?.script).not.toContain('@costume ada/wedding')
		}
	},
)

test.each([
	[
		'protects the sole inherited background in the next scene',
		'@bg z-hall/day\n@bg a-room/day',
		'ada: Two. #0020',
	],
	[
		'folds a mid-scene change into the inherited background',
		'@bg a-room/day',
		'ada: Two. #0020\n@bg z-hall/day\nada: Three. #0030',
	],
])('%s', (_name, opening, next) => {
	const fit = trimStagingToBudget(
		{
			script: `scene First
source p0001

${opening}
ada: One. #0010

scene Second
source p0002

${next}
`,
			items: [
				{ id: 'a-room/day', kind: 'location', description: 'Room' },
				{ id: 'z-hall/day', kind: 'location', description: 'Hall' },
			],
			merges: {},
		},
		bible,
		empty,
		{ limit: 1, previousBases: new Map(), reusedImages: new Set() },
		(script, { entries }) => {
			const compiled = compileScript(script, {
				assets: entries,
				paragraphIds: ['p0001', 'p0002'],
				speakers: ['ada'],
			})
			return compiled.ok ? compiled.scenes : undefined
		},
	)
	expect(fit?.trimmed).toEqual([
		{ id: 'z-hall/day', replacement: 'a-room/day' },
	])
	expect(fit?.script).not.toContain('z-hall/day')
})

test('folds into a less-used drawn costume when the favorite would not save an image', () => {
	const drawn = 'ada/uniform/neutral'
	const favorite = 'ada/wedding/neutral'
	const fit = trimStagingToBudget(
		{
			script: `scene Room
source p0001

@show ${favorite} center
@face ${favorite}
@costume ada/uniform
ada: One. #0010
`,
			items: [{ id: favorite, kind: 'character', description: 'Wedding' }],
			merges: {},
		},
		bible,
		{
			...empty,
			entries: [
				{
					id: drawn,
					type: 'character',
					status: 'drawn',
					path: 'assets/characters/ada/uniform/neutral.webp',
					aliases: [],
				},
			],
		},
		{ limit: 0, previousBases: new Map(), reusedImages: new Set() },
		(script, { entries }) => {
			const compiled = compileScript(script, {
				assets: entries,
				paragraphIds: ['p0001'],
				speakers: ['ada'],
			})
			return compiled.ok ? compiled.scenes : undefined
		},
	)
	expect(fit?.trimmed).toEqual([{ id: favorite, replacement: drawn }])
	expect(fit?.script).toContain(`@show ${drawn} center\n@face ${drawn}`)
	expect(fit?.items).toEqual([])
})

test('reports the remaining image count and protected minimum after an unsuccessful trim', async () => {
	const response = JSON.stringify({
		patch: 'PUT <4:\n@bg room/day\n@cg cg-window',
		items: [
			{ id: 'room/day', kind: 'location', description: 'Room' },
			{ id: 'cg-window', kind: 'cg', description: 'Window' },
		],
		merges: {},
	})
	const fetch = artReplies(response, response)
	await expect(
		directChapterArt(script, bible, empty, {
			main,
			replay: { ...replay, mode: 'replay', fetch },
			imageBudget: {
				limit: 0,
				paragraphIds: ['p0001'],
				speakers: ['ada'],
				previousBases: new Map(),
				reusedImages: new Set(),
			},
		}),
	).rejects.toThrow(
		'Chapter needs 1 new provider images after trimming; budget is 0. Protected minimum: 1.',
	)
})

test('trim remaps stage assets after leading named options without changing the options', async () => {
	const response = JSON.stringify({
		patch: [
			'PUT <4:',
			'@bg transition fade duration 0.6 room/rain',
			'@show duration 0.7 ada/uniform/angry center',
			'@face duration 0.8 ada/angry',
		].join('\n'),
		items: [
			{ id: 'room/rain', kind: 'variant', description: 'Rain' },
			{ id: 'ada/uniform/angry', kind: 'expression', description: 'Angry' },
		],
		merges: {},
	})
	const fetch = artReplies(response, response)
	const staged = await directChapterArt(script, bible, empty, {
		main,
		replay: { ...replay, mode: 'replay', fetch },
		imageBudget: {
			limit: 2,
			paragraphIds: ['p0001'],
			speakers: ['ada'],
			previousBases: new Map(),
			reusedImages: new Set(),
		},
	})
	expect(fetch).toHaveBeenCalledTimes(2)
	expect(staged.script).toContain(
		'@bg transition fade duration 0.6 room/day\n' +
			'@show duration 0.7 ada/uniform/neutral center\n' +
			'@face duration 0.8 ada/neutral',
	)
})

test.each([true, false])(
	'uses the staging manifest repair once for invalid JSON (valid repair: %s)',
	async (valid) => {
		const malformed = '{"patch":"" "items":[],"merges":{}}'
		const fetch = artReplies(
			malformed,
			valid ? '{"patch":"","items":[],"merges":{}}' : malformed,
		)
		const result = directChapterArt(script, bible, empty, {
			main,
			replay: { ...replay, mode: 'replay', fetch },
		})
		if (valid) await expect(result).resolves.toMatchObject({ items: [] })
		else await expect(result).rejects.toThrow('Art model returned invalid JSON')
		expect(fetch).toHaveBeenCalledTimes(2)
		const [input, init] = fetch.mock.calls[1]
		expect(
			JSON.stringify((await new Request(input, init).json()).messages),
		).toContain('Repair the JSON manifest: Art model returned invalid JSON')
	},
)

test('requests repair when a staging patch adds an image absent from the manifest', async () => {
	const patch = 'PUT <4:\n@cg cg-window'
	const item = { id: 'cg-window', kind: 'cg', description: '窗边' }
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockResolvedValueOnce({ patch, items: [], merges: {} })
		.mockResolvedValueOnce({ patch, items: [item], merges: {} })
	try {
		const staged = await directChapterArt(script, bible, empty, {
			main,
			replay,
		})
		expect(staged.items).toEqual([item])
		expect(model).toHaveBeenCalledTimes(2)
		expect(model.mock.calls[1][1]).toContain(
			'Repair the staging patch and manifest',
		)
		expect(model.mock.calls[1][1]).toContain('cg-window')
	} finally {
		model.mockRestore()
	}
})

test('requests a schema repair for bare model-generated place IDs after a staging repair', async () => {
	const patch = 'PUT <4:\n@cg cg-window'
	const cg = { id: 'cg-window', kind: 'cg', description: '窗边' }
	const courtyard = {
		id: 'loc_courtyard',
		kind: 'location',
		description: '庭院',
	}
	const gate = { id: 'loc_gate', kind: 'location', description: '石门' }
	const corrected = [
		{ ...courtyard, id: 'loc_courtyard/day' },
		cg,
		{ ...gate, id: 'loc_gate/day' },
	]
	const answers = [
		{ patch, items: [], merges: {} },
		{
			patch: 'PUT <4:\n@bg loc_courtyard\n@cg cg-window\nPUT >4:\n@bg loc_gate',
			items: [courtyard, cg, gate],
			merges: {},
		},
		{
			patch:
				'PUT <4:\n@bg loc_courtyard/day\n@cg cg-window\nPUT >4:\n@bg loc_gate/day',
			items: corrected,
			merges: {},
		},
	]
	const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
		const { messages } = await new Request(input, init).json()
		const answer = answers.shift()
		if (!answer) throw new Error('Unexpected art-director request')
		const chunk = {
			choices: [
				{
					index: 0,
					delta: { content: JSON.stringify(answer) },
					finish_reason: 'stop',
				},
			],
		}
		const prompt = messages[0].content[0].text
		if (answers.length === 1)
			expect(prompt).toContain('Repair the staging patch and manifest')
		if (answers.length === 0) {
			expect(prompt).not.toContain('Repair the staging patch and manifest')
			expect(prompt).toContain('/items/0/id')
			expect(prompt).toContain('/items/2/id')
			expect(prompt).toContain('location: place/variant')
			expect(prompt).toContain('character: character/costume/expression')
			expect(prompt).toContain('"id":"loc_courtyard"')
			expect(prompt).toContain('"id":"loc_gate"')
		}
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
			headers: { 'content-type': 'text/event-stream' },
		})
	})
	const staged = await directChapterArt(script, bible, empty, {
		main,
		replay: { ...replay, mode: 'replay', fetch },
	})
	expect(fetch).toHaveBeenCalledTimes(3)
	expect(staged.items).toEqual(corrected)
	const plan = planArt(staged.items, bible, empty, staged.merges)
	const compiled = compileScript(staged.script, {
		assets: plan.registry.entries,
		speakers: ['ada'],
		paragraphIds: ['p0001'],
	})
	expect(compiled.ok).toBe(true)
	expect(
		compiled.ok &&
			compiled.scenes[0].beats
				.flatMap(({ actions }) => actions)
				.filter(({ name }) => name === 'bg')
				.map(({ assets }) => assets),
	).toEqual([[{ id: 'loc_courtyard/day' }], [{ id: 'loc_gate/day' }]])
})

test('staging repair edits the schema-corrected reply, not the original rejection', async () => {
	const original = {
		patch: 'PUT <4:\n@bg loc_courtyard',
		items: [{ id: 'loc_courtyard', kind: 'location', description: '庭院' }],
		merges: {},
	}
	const corrected = {
		...original,
		patch: 'PUT <4:\n@bg loc_courtyard/day',
		items: [{ ...original.items[0], id: 'loc_courtyard/evening' }],
	}
	const staged = {
		...corrected,
		items: [{ ...original.items[0], id: 'loc_courtyard/day' }],
	}
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockRejectedValueOnce(
			new artModels.ArtResponseSchemaError('/items/0/id', original),
		)
		.mockResolvedValueOnce(corrected)
		.mockResolvedValueOnce(staged)
	try {
		await expect(
			directChapterArt(script, bible, empty, { main, replay }),
		).resolves.toMatchObject({ items: staged.items })
		expect(model).toHaveBeenCalledTimes(3)
		expect(model.mock.calls[1][1]).toContain(JSON.stringify(original))
		const retry = model.mock.calls[2][1]
		expect(retry).toContain('Repair the staging patch and manifest')
		expect(retry).toContain(JSON.stringify(corrected))
		expect(retry).not.toContain(JSON.stringify(original))
		expect(retry).not.toContain('Repair the JSON manifest')
	} finally {
		model.mockRestore()
	}
})

test('repairs a bare place ID and then reports every incomplete character asset by item path', async () => {
	const location = { id: 'room', kind: 'location', description: 'Classroom' }
	const character = {
		id: 'ada/uniform',
		kind: 'character',
		description: 'Blue uniform',
	}
	const coat = { ...character, id: 'ada/coat', description: 'Coat' }
	const reply = (place: string, uniform: string, outerwear: string) => ({
		patch: `PUT <4:\n@bg ${place}\n@show ${uniform} center\nPUT >4:\n@show ${outerwear} center`,
		items: [
			{ ...location, id: place },
			{ ...character, id: uniform },
			{ ...coat, id: outerwear },
		],
		merges: {},
	})
	const corrected = reply('room/day', 'ada/uniform/neutral', 'ada/coat/neutral')
	const registry = planArt(
		[{ id: 'room/day', kind: 'location', description: 'Classroom' }],
		bible,
		empty,
	).registry
	const fetch = artReplies(
		...[
			reply('room', character.id, coat.id),
			reply('room/day', character.id, coat.id),
			corrected,
		].map((answer) => JSON.stringify(answer)),
	)
	const staged = await directChapterArt(script, bible, registry, {
		main,
		replay: { ...replay, mode: 'replay', fetch },
	})
	expect(staged.items).toEqual(corrected.items)
	const plan = planArt(staged.items, bible, registry, staged.merges)
	expect(
		compileScript(staged.script, {
			assets: plan.registry.entries,
			speakers: ['ada'],
			paragraphIds: ['p0001'],
		}).ok,
	).toBe(true)
	expect(fetch).toHaveBeenCalledTimes(3)
	const prompts = await Promise.all(
		fetch.mock.calls.map(async ([input, init]) => {
			const { messages } = await new Request(input, init).json()
			return messages[0].content[0].text as string
		}),
	)
	for (const prompt of prompts) {
		expect(prompt).toContain('character: character/costume/expression')
		expect(prompt).toContain('never ada or ada/uniform')
		expect(prompt).toContain('using single-segment IDs from the bible')
		expect(prompt).toContain(
			'Reuse a full ID verbatim only from registry.entries.',
		)
		const [brief] = prompt.split('\nRepair the ', 1)
		expect(brief).toContain(
			`Bible and registered assets: ${JSON.stringify({ bible, registry })}`,
		)
		expect(brief.match(/"id":"ada"/g)).toHaveLength(1)
		expect(brief.match(/"id":"room\/day"/g)).toHaveLength(1)
	}
	expect(prompts[1]).toContain('"/items/0/id","keyword":"pattern"')
	expect(prompts[2]).toContain(
		'/items/1/id: Invalid character asset "ada/uniform"; expected character/costume/expression',
	)
	expect(prompts[2]).toContain(
		'/items/2/id: Invalid character asset "ada/coat"; expected character/costume/expression',
	)
	expect(prompts[2]).toContain(
		'update affected patch and merge references together',
	)
})

test('preserves configured custom marks through staging and rejects unconfigured marks', async () => {
	const marked = script.replace('窗外下雨了。', '{wave}窗外下雨了。{/wave}')
	const model = vi.spyOn(artModels, 'artJson').mockResolvedValueOnce({
		patch: 'PUT <4:\n@cg cg-window',
		items: [{ id: 'cg-window', kind: 'cg', description: '窗边' }],
		merges: {},
	})
	try {
		await expect(
			directChapterArt(marked, bible, empty, { main, replay }),
		).rejects.toThrow('requires a valid chapter script')
		const staged = await directChapterArt(marked, bible, empty, {
			main,
			replay,
			customMarks: new Set(['wave']).values(),
		})
		expect(staged.script).toContain(
			'@cg cg-window\nada: {wave}窗外下雨了。{/wave}',
		)
		expect(staged.cgReferences.has('cg-window')).toBe(true)
		expect(model).toHaveBeenCalledTimes(1)
	} finally {
		model.mockRestore()
	}
})

test.each(['audit rejection', 'undecodable redraw'] as const)(
	'keeps the last usable visual after %s and reuses saved candidates',
	async (redraw) => {
		const frames: Buffer[] = []
		const render = vi
			.fn<ReturnType<typeof artModels.imageRenderer>>()
			.mockImplementation(async (_prompt, _refs, size) => {
				if (redraw === 'undecodable redraw' && render.mock.calls.length === 3)
					return { bytes: Buffer.from('not an image') }
				const bytes = await sharp({
					create: {
						...size,
						channels: 3,
						background: { r: 40 + 50 * frames.length, g: 80, b: 120 },
					},
				})
					.png()
					.toBuffer()
				frames.push(bytes)
				return { bytes }
			})
		const renderer = vi
			.spyOn(artModels, 'imageRenderer')
			.mockReturnValue(render)
		const model = vi
			.spyOn(artModels, 'artJson')
			.mockImplementation(async (_connection, prompt) => {
				if (!prompt.startsWith('Visually audit')) return { content: '窗光' }
				return prompt.includes('构图候选 2：')
					? { pass: false, failedChecks: ['style'], feedback: '收敛画风' }
					: { pass: true, failedChecks: [], feedback: '' }
			})
		try {
			await projectTest(async (project) => {
				const art = service(project, replay)
				const input = { ...bible, characters: [] }
				const pool = await art.candidates(input, ['c1'])
				expect(pool.mainVisuals.map(({ id }) => id)).toEqual([
					'visual-1',
					'visual-2',
					'visual-3',
				])
				expect(render).toHaveBeenCalledTimes(4)
				expect(render.mock.calls[2][0]).toContain('收敛画风')
				expect(
					model.mock.calls.filter(([, prompt]) =>
						prompt.startsWith('Visually audit'),
					),
				).toHaveLength(redraw === 'audit rejection' ? 4 : 3)
				const saved = await project.readFile(pool.mainVisuals[1].cachePath)
				const pixel = async (bytes: Buffer) =>
					(await sharp(bytes).resize(1, 1).raw().toBuffer())[0]
				expect(await pixel(saved)).toBeCloseTo(
					await pixel(frames[redraw === 'audit rejection' ? 2 : 1]),
					-1,
				)
				if (redraw === 'audit rejection')
					expect(await pixel(saved)).not.toBeCloseTo(await pixel(frames[1]), -1)
				expect(await art.candidates(input, ['c1'])).toEqual(pool)
				expect(render).toHaveBeenCalledTimes(4)
			})
		} finally {
			renderer.mockRestore()
			model.mockRestore()
		}
	},
	30_000,
)

test('uses a supplied character design in both costume candidate rendering and auditing', async () => {
	const render = vi
		.fn<ReturnType<typeof artModels.imageRenderer>>()
		.mockImplementation(async (_prompt, _refs, size, alpha) => ({
			bytes: await picture(size.width, size.height, alpha),
		}))
	const renderer = vi.spyOn(artModels, 'imageRenderer').mockReturnValue(render)
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(async (_connection, prompt) =>
			prompt.startsWith('Visually audit')
				? { pass: true, failedChecks: [], feedback: '' }
				: { content: '窗光' },
		)
	try {
		await projectTest(async (project) => {
			const path = 'assets/ada-design.png'
			const design = await picture(64, 96, true)
			await project.writeFile(path, design)
			const art = service(project, replay)
			await art.candidates(
				{
					...bible,
					characters: [
						{
							...bible.characters[0],
							references: [{ path, description: '创作者设定图' }],
						},
					],
				},
				['c1'],
			)
			const portraits = render.mock.calls.filter((call) => call[3])
			expect(portraits).toHaveLength(3)
			for (const [prompt, refs] of portraits) {
				expect(prompt).toContain('ada character design reference')
				expect(refs).toHaveLength(1)
				expect(await sharp(refs[0]).metadata()).toMatchObject({
					width: 64,
					height: 96,
				})
			}
			const audits = model.mock.calls.filter(([, prompt]) =>
				prompt.includes('ada character design reference'),
			)
			expect(audits).toHaveLength(3)
			for (const [, prompt, , , images] of audits) {
				expect(images).toHaveLength(2)
				expect(prompt).toMatch(/Original image brief .*: 造型候选 \d：蓝色制服/)
				expect(prompt).toContain('窗光')
				expect(prompt).toContain(
					'Image 2 is the ada character design reference.',
				)
				expect(prompt).not.toContain(
					'Image 1 is the ada character design reference.',
				)
			}
		})
	} finally {
		renderer.mockRestore()
		model.mockRestore()
	}
}, 30_000)

test.each([
	{ rejection: 'none', first: 'costume-epub', calls: [1, 0, 0], onReopen: 0 },
	{
		rejection: 'prompt',
		code: 'InputTextRiskDetection',
		first: 'costume-epub',
		calls: [1, 1, 0, 0],
		onReopen: 0,
	},
	{
		rejection: 'unknown',
		code: 'OutputImageRiskDetection',
		first: 'costume-1',
		calls: [1, 1, 0, 0, 0],
		onReopen: 2,
	},
	{
		rejection: 'reference HTTP error',
		code: 'InputImageRiskDetection',
		first: 'costume-1',
		calls: [1, 0, 0, 0],
		onReopen: 1,
	},
	{
		rejection: 'reference item error',
		code: 'InputImageSensitiveContentDetected.PrivacyInformation',
		first: 'costume-1',
		calls: [1, 0, 0, 0],
		onReopen: 1,
	},
])(
	'chooses the EPUB costume moderation retry for $rejection',
	async ({ rejection, code, first, calls, onReopen }) => {
		const rewritten = '上一次生成被内容审核拒绝，请收敛描写'
		type ImageRequest = {
			prompt: string
			image?: string[]
			size: string
			background?: string
		}
		const requests: ImageRequest[] = []
		const render = artModels.imageRenderer
		const renderer = vi
			.spyOn(artModels, 'imageRenderer')
			.mockImplementation((config) =>
				render(
					{ ...config, baseUrl: 'https://fixture.volces.com/api/v3' },
					{
						replay: {
							mode: 'replay',
							directory,
							fetch: async (input, init) => {
								const request = new Request(input, init)
								expect(request.url).toBe(
									'https://fixture.volces.com/api/v3/images/generations',
								)
								const body: ImageRequest = await request.json()
								requests.push(body)
								const alpha = body.background === 'transparent'
								if (
									alpha &&
									body.image?.length &&
									code &&
									(rejection !== 'prompt' || !body.prompt.includes(rewritten))
								) {
									const error = { code, message: 'Content rejected' }
									return rejection === 'reference item error'
										? Response.json({ data: [{ error }] })
										: Response.json({ error }, { status: 400 })
								}
								const [width, height] = body.size.split('x').map(Number)
								return Response.json({
									data: [
										{
											b64_json: (await picture(width, height, alpha)).toString(
												'base64',
											),
										},
									],
								})
							},
						},
					},
				),
			)
		const model = vi
			.spyOn(artModels, 'artJson')
			.mockImplementation(async (_connection, prompt) =>
				prompt.startsWith('Visually audit')
					? { pass: true, failedChecks: [], feedback: '' }
					: { content: '窗光' },
			)
		try {
			await projectTest(async (project) => {
				const path = 'source/imports/illustrations/illustration-1.png'
				await project.writeFile(path, await picture(64, 96, false))
				const art = service(project, replay)
				const references = new Map([
					['ada', { id: 'illustration-1', cachePath: path }],
				])
				const pool = await art.candidates(
					bible,
					['c1'],
					undefined,
					[],
					references,
				)
				expect(pool.characters[0].candidates.map(({ id }) => id)).toEqual([
					first,
					'costume-2',
					'costume-3',
				])
				const portraits = requests.filter(
					({ background }) => background === 'transparent',
				)
				expect(portraits.map(({ image }) => image?.length ?? 0)).toEqual(calls)
				expect(portraits[0].prompt).toContain(
					'ada EPUB character design reference',
				)
				if (rejection === 'prompt' || rejection === 'unknown') {
					expect(portraits[1].prompt).toContain(rewritten)
					expect(portraits[1].image).toEqual(portraits[0].image)
				}
				if (first === 'costume-1')
					expect(portraits[calls.lastIndexOf(1) + 1].prompt).not.toContain(
						'EPUB character design reference',
					)
				expect(
					await art.candidates(bible, ['c1'], undefined, [], references),
				).toEqual(pool)
				expect(requests).toHaveLength(3 + calls.length + onReopen)
			})
		} finally {
			renderer.mockRestore()
			model.mockRestore()
		}
	},
	30_000,
)
