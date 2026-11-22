import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
