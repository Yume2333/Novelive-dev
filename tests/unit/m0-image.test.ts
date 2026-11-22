import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import OpenAI from 'openai'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheResponse } from '../../packages/creator/src/host-runtime/cache'
import {
	hasTransparency,
	type ImageConfig,
	imageError,
	imageProvider,
	imageSize,
	testImage,
} from '../../packages/creator/src/models/image'

const directory = 'tests/fixtures/image-models'
const dirs: string[] = []
afterEach(async () => {
	vi.unstubAllGlobals()
	await Promise.all(
		dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	)
})
const base: ImageConfig = {
	baseUrl: 'https://relay.invalid/v1',
	apiKey: 'synthetic-key',
	model: '',
	concurrency: 8,
	retries: 3,
	quality: 'high',
	nativeMaxEdge: 1536,
	postProcess: 'single',
	upscaleTier: 'anime',
}
async function probe(scenario: string, seedream = false) {
	const cacheDir = await mkdtemp(join(tmpdir(), 'novelive-image-'))
	dirs.push(cacheDir)
	const network = vi.fn(() => {
		throw new Error('Real network forbidden')
	})
	vi.stubGlobal('fetch', network)
	const results = await testImage(
		{
			...base,
			model: `${seedream ? 'seedream-5.5' : 'gpt-image'}-synthetic-${scenario}`,
		},
		{ cacheDir, replay: { mode: 'strict', directory } },
	)
	expect(network).not.toHaveBeenCalled()
	return { results, cacheDir }
}

describe('native sizes', () => {
	for (const provider of ['openai', 'seedream-5.5', 'seedream-4.5'] as const) {
		for (const tier of [1536, 2048, 2560, 2816, 3840] as const) {
			for (const portrait of [false, true])
				it(`${provider} ${tier} portrait=${portrait}`, () => {
					const { width, height } = imageSize(provider, tier, portrait)
					expect(width % 16).toBe(0)
					expect(height % 16).toBe(0)
					const pixels = width * height
					expect(pixels).toBeLessThanOrEqual(
						provider === 'openai'
							? 8294400
							: provider === 'seedream-5.5'
								? 4624220
								: 16777216,
					)
					expect(pixels).toBeGreaterThanOrEqual(
						provider === 'seedream-4.5'
							? 3686400
							: provider === 'seedream-5.5'
								? 921600
								: 0,
					)
					expect(width / height).toBeCloseTo(portrait ? 2 / 3 : 16 / 9, 1)
					if (provider !== 'seedream-4.5')
						expect(Math.max(width, height)).toBeLessThanOrEqual(tier)
				})
		}
	}
	it('known tier examples and provider detection', () => {
		expect(imageSize('openai', 1536)).toEqual({ width: 1536, height: 864 })
		expect(imageSize('openai', 1536, true)).toEqual({
			width: 1024,
			height: 1536,
		})
		expect(imageSize('openai', 3840)).toEqual({ width: 3840, height: 2160 })
		expect(imageSize('seedream-4.5', 1536)).toEqual({
			width: 2560,
			height: 1440,
		})
		expect(
			imageProvider('https://ark.cn-beijing.volces.com/api/v3', 'endpoint-id'),
		).toBe('seedream-5.5')
		expect(imageProvider(base.baseUrl, 'doubao-seedream-4-5')).toBe(
			'seedream-4.5',
		)
	})
})

for (const seedream of [false, true])
	describe(seedream ? 'Seedream' : 'OpenAI', () => {
		it('three independent capabilities and protocol-readable images + thumbnails (synthetic)', async () => {
			const { results, cacheDir } = await probe('alpha', seedream)
			for (const result of Object.values(results)) {
				expect(result.ok).toBe(true)
				if (!result.ok) throw new Error(JSON.stringify(result))
				for (const path of [result.path, result.thumbnail]) {
					const response = await cacheResponse(
						cacheDir,
						`novelive://cache/${path}`,
					)
					expect(response.status).toBe(200)
					expect(
						(await sharp(Buffer.from(await response.arrayBuffer())).metadata())
							.width,
					).toBeGreaterThan(0)
				}
			}
		})
		it.each([
			['opaque', 'transparent', 'unsupported'],
			['edit404', 'edit', 'unsupported'],
			['size400', 'generate', 'unsupported'],
			['unsupported', 'transparent', 'unsupported'],
			['moderation', 'generate', 'moderation'],
			['auth', 'generate', 'auth'],
			['network', 'generate', 'network'],
			['empty', 'generate', 'internal'],
			['bad-image', 'generate', 'internal'],
			['url-error', 'generate', 'network'],
		] as const)('%s → %s %s', async (scenario, capability, code) => {
			const { results } = await probe(scenario, seedream)
			const result = results[capability]
			expect(result).toMatchObject({ ok: false, error: { code } })
			if (code === 'unsupported' && !result.ok)
				expect(result.error.message).toMatch(/透明底|图片编辑|文生图/)
			if (scenario === 'size400') expect(results.edit.ok).toBe(true)
		})
		it('normalizes downloaded URL images through replay too', async () => {
			const { results } = await probe('url', seedream)
			expect(Object.values(results).every((result) => result.ok)).toBe(true)
		})
	})

it('alpha threshold requires fully transparent pixels, including exact 0.5%', async () => {
	for (const [count, alpha, expected] of [
		[2, 0, true],
		[1, 0, false],
		[400, 1, false],
	] as const) {
		const pixels = Buffer.alloc(20 * 20 * 4, 255)
		for (let i = 0; i < count; i++) pixels[i * 4 + 3] = alpha
		const png = await sharp(pixels, {
			raw: { width: 20, height: 20, channels: 4 },
		})
			.png()
			.toBuffer()
		expect(await hasTransparency(png)).toBe(expected)
	}
})
it('missing configuration and cancellation never issue a request', async () => {
	const fetch = vi.fn(() => {
		throw new Error('Unexpected network')
	})
	vi.stubGlobal('fetch', fetch)
	const empty = await testImage(base, { cacheDir: 'unused' })
	expect(empty.generate).toMatchObject({
		ok: false,
		error: { code: 'invalid_config' },
	})
	const cancelled = await testImage(
		{ ...base, model: 'synthetic' },
		{ cacheDir: 'unused', signal: AbortSignal.abort() },
	)
	for (const result of Object.values(cancelled))
		expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
	expect(fetch).not.toHaveBeenCalled()
})
it('error precedence, connection errors and safe messages', () => {
	expect(
		imageError(
			new OpenAI.APIConnectionError({ message: 'private relay' }),
			'edit',
		).code,
	).toBe('network')
	const error = new OpenAI.APIError(
		404,
		{ code: 'model_not_found' },
		'private relay',
		new Headers(),
	)
	expect(imageError(error, 'edit').code).toBe('not_found')
	expect(imageError(error, 'edit').message).not.toContain('private relay')
})
