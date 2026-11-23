import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	backfill,
	checkVariantProfile,
	postprocess,
	profileStatePath,
	readProfiles,
	recordProfile,
	resolveUpscale,
	variantProfile,
} from '../../packages/creator/src/pipeline/postprocess'
// @ts-expect-error 开发工具的 ESM 入口
import { fetchUpscale } from '../../tools/upscale/fetch.mjs'

const target = { width: 32, height: 48 }
const options = { mode: 'single', tier: 'anime', target, fit: 'fill' } as const
let opaque: Buffer
let portrait: Buffer
let binary: string

beforeAll(async () => {
	expect(process.env.NL_REPLAY).toBe('strict')
	binary = await fetchUpscale()
	const fixture = await readFile('.workflow/evidence/m1b/offline/01-import.png')
	opaque = await sharp(fixture)
		.resize(16, 24, { fit: 'fill' })
		.removeAlpha()
		.png()
		.toBuffer()
	const alpha = Buffer.alloc(16 * 24, 0)
	for (let y = 4; y < 20; y++)
		for (let x = 4; x < 12; x++)
			alpha[y * 16 + x] = x === 4 || x === 11 ? 128 : 255
	portrait = await sharp(opaque)
		.joinChannel(alpha, { raw: { width: 16, height: 24, channels: 1 } })
		.png()
		.toBuffer()
}, 120_000)

describe('M3 本地放大', () => {
	it.each(['anime', 'fast', 'detail'] as const)(
		'%s：真实二进制与 RGBA',
		async (tier) => {
			const start = performance.now()
			for (const image of [opaque, portrait]) {
				const progress: number[] = []
				const png = await postprocess(
					image,
					{ ...options, tier },
					{ binary, onProgress: (value) => progress.push(value) },
				)
				const metadata = await sharp(png).metadata()
				const off = await postprocess(image, { ...options, mode: 'off', tier })
				expect(await sharp(png).raw().toBuffer()).not.toEqual(
					await sharp(off).raw().toBuffer(),
				)
				expect(metadata).toMatchObject({ ...target, format: 'png' })
				expect(progress.at(-1)).toBe(1)
				expect(progress.some((value) => value < 1)).toBe(true)
				if (image === portrait) {
					expect(metadata.hasAlpha).toBe(true)
					const { data, info } = await sharp(png)
						.ensureAlpha()
						.raw()
						.toBuffer({ resolveWithObject: true })
					const alphaAt = (x: number, y: number) =>
						data[(y * info.width + x) * 4 + 3]
					expect(alphaAt(0, 0)).toBeLessThan(10)
					expect(alphaAt(16, 24)).toBeGreaterThan(240)
					expect(alphaAt(8, 24)).toBeGreaterThan(20)
					expect(alphaAt(8, 24)).toBeLessThan(235)
				}
				const webp = await sharp(png).webp({ quality: 90 }).toBuffer()
				expect(await sharp(webp).metadata()).toMatchObject({
					...target,
					format: 'webp',
					hasAlpha: metadata.hasAlpha,
				})
			}
			console.log(
				`${tier}: ${((performance.now() - start) / 1000).toFixed(3)}s（RGB + RGBA，16×24）`,
			)
		},
		120_000,
	)

	it('关闭不启动二进制；双次回到原尺寸再放大', async () => {
		const off = await postprocess(
			portrait,
			{ ...options, mode: 'off' },
			{ binary: '/missing' },
		)
		const expected = await sharp(portrait)
			.resize({ ...target, fit: 'fill', kernel: 'lanczos3' })
			.png()
			.toBuffer()
		expect(off).toEqual(expected)
		const once = await postprocess(
			portrait,
			{ ...options, tier: 'fast', target: { width: 16, height: 24 } },
			{ binary },
		)
		const twice = await postprocess(
			once,
			{ ...options, tier: 'fast' },
			{ binary },
		)
		const double = await postprocess(
			portrait,
			{ ...options, tier: 'fast', mode: 'double' },
			{ binary },
		)
		expect(double).toEqual(twice)
	}, 120_000)

	it('基准优先，拒绝档位/模式不一致', () => {
		expect(variantProfile(options)).toEqual({ mode: 'single', tier: 'anime' })
		expect(() =>
			checkVariantProfile(options, { ...options, tier: 'fast' }),
		).toThrow('不一致')
		expect(() =>
			checkVariantProfile(options, { ...options, mode: 'double' }),
		).toThrow('不一致')
		expect(() => checkVariantProfile(options, options)).not.toThrow()
	})

	it('顺序回填、失败不替换旧图，继续后续并持久化档位', async () => {
		const files = new Map<string, Buffer>([
			['base.webp', opaque],
			['bad.webp', Buffer.from('old broken bytes')],
			['variant.webp', portrait],
		])
		const project = {
			readFile: async (path: string) => {
				const bytes = files.get(path)
				if (!bytes)
					throw Object.assign(new Error('not found'), { code: 'ENOENT' })
				return bytes
			},
			writeFile: async (path: string, bytes: Buffer) => {
				files.set(path, bytes)
			},
		}
		const assets = [
			{ path: 'base.webp', options: { ...options, tier: 'fast' as const } },
			{ path: 'bad.webp', options },
			{ path: 'variant.webp', basePath: 'base.webp', options },
		]
		const old = files.get('bad.webp')
		await recordProfile(project, 'recorded.webp', options)
		expect((await readProfiles(project))['recorded.webp'].profile).toEqual(
			variantProfile(options),
		)
		const results = await backfill(project, assets, { binary, lossless: true })
		expect(results.map((result) => result.status)).toEqual([
			'processed',
			'failed',
			'processed',
		])
		expect(files.get('bad.webp')).toEqual(old)
		for (const path of ['base.webp', 'variant.webp'])
			expect(await sharp(files.get(path)).metadata()).toMatchObject({
				...target,
				format: 'webp',
			})
		const state = await readProfiles(project)
		expect(state['variant.webp'].profile).toEqual(state['base.webp'].profile)
		expect(state['bad.webp'].error).toBeTruthy()
		expect(files.has(profileStatePath)).toBe(true)
		expect(await backfill(project, [], { binary })).toEqual([])
		expect(
			(await backfill(project, assets.slice(0, 1), { binary: '/missing' }))[0]
				.status,
		).toBe('skipped')
	}, 120_000)

	it.skipIf(process.platform === 'win32')(
		'第二次进程未写输出时拒绝复用第一次结果',
		async () => {
			const directory = await mkdtemp(join(tmpdir(), 'upscale-stale-'))
			try {
				const seed = join(directory, 'seed.png')
				const marker = join(directory, 'finished')
				const executable = join(directory, 'upscale.mjs')
				await writeFile(
					seed,
					await sharp(opaque).resize(64, 96).png().toBuffer(),
				)
				await writeFile(
					executable,
					`#!/usr/bin/env node
import { existsSync, copyFileSync, writeFileSync } from 'node:fs'
if (!existsSync(${JSON.stringify(marker)})) {
	copyFileSync(${JSON.stringify(seed)}, process.argv[process.argv.indexOf('-o') + 1])
	writeFileSync(${JSON.stringify(marker)}, '')
}
`,
				)
				await chmod(executable, 0o755)
				await expect(
					postprocess(
						opaque,
						{ ...options, mode: 'double' },
						{ binary: executable },
					),
				).rejects.toMatchObject({ code: 'ENOENT' })
				expect(await readFile(marker, 'utf8')).toBe('')
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		},
	)

	it('空图、进程错误和取消会拒绝；目录可覆盖，下载幂等', async () => {
		expect(resolveUpscale({ binary: 'custom', models: 'models' })).toEqual({
			binary: 'custom',
			models: 'models',
		})
		expect(await fetchUpscale()).toBe(binary)
		await expect(fetchUpscale('unknown')).rejects.toThrow('不支持')
		await expect(postprocess(Buffer.alloc(0), options)).rejects.toThrow()
		await expect(
			postprocess(opaque, options, { binary: '/missing' }),
		).rejects.toThrow()
		const controller = new AbortController()
		controller.abort()
		await expect(
			postprocess(opaque, options, { signal: controller.signal }),
		).rejects.toThrow()
		const directory = await mkdtemp(join(tmpdir(), 'upscale-invalid-'))
		try {
			await expect(
				postprocess(opaque, options, { binary, models: directory }),
			).rejects.toThrow()
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}, 120_000)
})
