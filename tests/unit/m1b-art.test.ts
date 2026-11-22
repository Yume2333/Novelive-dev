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
