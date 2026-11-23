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

test('an expression edit requests facial changes without repainting the transparent background', async () => {
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
				: {
						content: prompt.includes('Do not describe a setting')
							? 'Drawn brows and pressed lips.'
							: 'Drawn brows and pressed lips against a wooden hall.',
					},
		)
	try {
		await projectTest(async (project) => {
			const art = service(project, replay)
			const stylePath = 'assets/style-reference.png'
			const basePath = 'assets/base-sprite.png'
			const style = await picture(320, 180, false)
			await project.writeFile(stylePath, style)
			await project.writeFile(basePath, await picture(1024, 1536, true))
			const styledBible = {
				...bible,
				style: {
					...bible.style,
					references: [{ path: stylePath, description: 'Main visual' }],
				},
			}
			const jobs = await art.register(
				[
					{
						id: 'ada/uniform/angry',
						kind: 'expression',
						description: '紧咬牙关',
					},
				],
				styledBible,
			)
			const expression = jobs.find((job) => job.kind === 'expression')
			if (!expression || !('baseAssetId' in expression))
				throw new Error('Missing expression job')
			await art.adopt(expression.baseAssetId, basePath)
			expect(await art.draw(expression, styledBible)).toEqual({
				status: 'drawn',
			})

			expect(model.mock.calls[0][1]).toContain(
				'only the changes to the base sprite',
			)
			expect(render).toHaveBeenCalledTimes(1)
			const [[prompt, refs, , alpha]] = render.mock.calls
			expect(alpha).toBe(true)
			expect(refs).toHaveLength(2)
			expect((await sharp(refs[0]).metadata()).hasAlpha).toBe(true)
			expect((await sharp(refs[1]).metadata()).hasAlpha).toBe(false)
			expect(prompt).toContain('Drawn brows and pressed lips.')
			expect(prompt).not.toContain('wooden hall')
			expect(prompt).toContain(
				'Preserve the transparent background and alpha edges of Image 1',
			)
			expect(prompt).toContain('Image 2 is a style reference only')
			expect(prompt).toContain(
				'stroke texture of Image 2 stay exactly as in Image 2',
			)
		})
	} finally {
		renderer.mockRestore()
		model.mockRestore()
	}
})

test.each([true, false])(
	'an opaque expression retries once with just the base sprite (alpha restored: %s)',
	async (restored) => {
		const render = vi
			.fn<ReturnType<typeof artModels.imageRenderer>>()
			.mockImplementation(async (_prompt, refs, size) => ({
				bytes: await picture(
					size.width,
					size.height,
					refs.length === 1 && restored,
				),
			}))
		const renderer = vi
			.spyOn(artModels, 'imageRenderer')
			.mockReturnValue(render)
		const model = vi
			.spyOn(artModels, 'artJson')
			.mockImplementation(async (_connection, prompt) =>
				prompt.startsWith('Visually audit')
					? { pass: true, failedChecks: [], feedback: '' }
					: { content: 'The brows furrow.' },
			)
		try {
			await projectTest(async (project) => {
				const art = service(project, replay)
				const stylePath = 'assets/style-reference.png'
				const basePath = 'assets/base-sprite.png'
				await project.writeFile(stylePath, await picture(320, 180, false))
				await project.writeFile(basePath, await picture(1024, 1536, true))
				const styledBible = {
					...bible,
					style: {
						...bible.style,
						references: [{ path: stylePath, description: 'Main visual' }],
					},
				}
				const jobs = await art.register(
					[
						{
							id: 'ada/uniform/angry',
							kind: 'expression',
							description: '双眉压低',
						},
					],
					styledBible,
				)
				const expression = jobs.find((job) => job.kind === 'expression')
				if (!expression || !('baseAssetId' in expression))
					throw new Error('Missing expression job')
				await art.adopt(expression.baseAssetId, basePath)
				expect(await art.draw(expression, styledBible)).toEqual(
					restored
						? { status: 'drawn' }
						: {
								status: 'unsupported',
								issue: expect.stringContaining('alpha'),
							},
				)
				expect(render).toHaveBeenCalledTimes(2)
				const [[, original], [retryPrompt, retry, , transparent]] =
					render.mock.calls
				expect(original).toHaveLength(2)
				expect(retry).toEqual([original[0]])
				expect(transparent).toBe(true)
				expect(retryPrompt).not.toContain('Image 2')
				expect(retryPrompt).toContain('The brows furrow.')
				const audit = model.mock.calls.filter(([, prompt]) =>
					prompt.startsWith('Visually audit'),
				)
				if (restored) {
					expect(audit).toHaveLength(1)
					expect(audit[0][1]).toContain('rendered from the base sprite alone')
					expect(audit[0][4]?.slice(1)).toEqual(original)
				} else expect(audit).toHaveLength(0)
				const entry = (await art.registry()).entries.find(
					({ id }) => id === expression.assetId,
				)
				expect(entry).toMatchObject({
					styleRefsDropped: true,
					status: restored ? 'drawn' : 'pending',
				})
			})
		} finally {
			renderer.mockRestore()
			model.mockRestore()
		}
	},
)

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
