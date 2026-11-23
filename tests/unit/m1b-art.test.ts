import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bool, obj } from '@earendil-works/pi-schema'
import { projectFiles } from '@novelive/format/model'
import { compileScript } from '@novelive/format/script'
import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import { checkImage } from '../../packages/creator/src/pipeline/art/check'
import {
	applyStagingPatch,
	directChapterArt,
} from '../../packages/creator/src/pipeline/art/director'
import * as artModels from '../../packages/creator/src/pipeline/art/models'
import { planArt } from '../../packages/creator/src/pipeline/art/plan'
import * as upscale from '../../packages/creator/src/pipeline/postprocess'
import { Project } from '../../packages/creator/src/project'
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

test('decodes a visual-review JSON object fenced by the provider', async () => {
	const content = '```json\n{"pass":true}\n```'
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

test('removes an opaque sprite background before validating and auditing the result', async () => {
	const svg = Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><path fill="#e8dfd7" d="M0 0h300v450H0z"/><ellipse fill="#3d2536" cx="150" cy="122" rx="49" ry="63"/><ellipse fill="#e1a07f" cx="150" cy="126" rx="36" ry="48"/><path fill="#5230a0" d="M112 175q-44 12-51 81l18 92 22-14 2 116h94l2-116 22 14 18-92q-7-69-51-81z"/></svg>',
	)
	const opaque = await sharp(svg).removeAlpha().png().toBuffer()
	const renderer = vi
		.spyOn(artModels, 'imageRenderer')
		.mockReturnValue(async () => ({ bytes: opaque }))
	const model = vi
		.spyOn(artModels, 'artJson')
		.mockImplementation(
			async (_connection, prompt, _schema, _options, images) => {
				if (!prompt.startsWith('Visually audit')) return { content: 'Ada' }
				const { data, info } = await sharp(images?.[0])
					.raw()
					.toBuffer({ resolveWithObject: true })
				expect(info.channels).toBe(4)
				expect(data[3]).toBe(0)
				const center =
					Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)
				expect(data[center * 4 + 3]).toBe(255)
				return { pass: true, failedChecks: [], feedback: '' }
			},
		)
	try {
		await projectTest(async (project) => {
			const art = service(project, replay)
			const [sprite] = await art.register(
				[{ id: 'ada/uniform/neutral', kind: 'character', description: 'Ada' }],
				bible,
			)
			vi.stubEnv('NL_MATTING_DIR', join(project.root, 'missing-matting'))
			await expect(art.draw(sprite, bible)).resolves.toEqual({
				status: 'unsupported',
				issue: '本地去背景不可用；请使用可返回透明底的图片模型。',
			})
			vi.unstubAllEnvs()
			expect(await art.draw(sprite, bible)).toEqual({ status: 'drawn' })
		})
	} finally {
		vi.unstubAllEnvs()
		renderer.mockRestore()
		model.mockRestore()
	}
}, 15_000)

test('staging patches cannot replace writer dialogue', () => {
	expect(() => applyStagingPatch(script, 'PUT 4.=4:\n@bg room/day')).toThrow(
		'Invalid staging patch',
	)
})

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
