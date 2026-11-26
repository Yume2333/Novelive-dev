import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
	apiKeyMasked,
	createConfigStore,
} from '../../packages/creator/src/config'

let userData: string
let path: string

beforeEach(async () => {
	userData = await mkdtemp(join(tmpdir(), 'novelive-config-'))
	path = join(userData, 'config.json')
})

afterEach(async () => {
	await rm(userData, { recursive: true, force: true })
})

describe('M0 configuration store', () => {
	test('starts with five empty model names and keys and the documented defaults', async () => {
		const store = createConfigStore(userData)
		const initial = await store.get()
		if ('configError' in initial) throw new Error(initial.configError.reason)
		expect(Object.keys(initial.models)).toEqual([
			'fast',
			'main',
			'writing',
			'visual',
			'image',
		])
		for (const slot of Object.values(initial.models)) {
			expect(slot).toMatchObject({ model: '', apiKeyMasked: '' })
			expect(slot).not.toHaveProperty('apiKey')
		}
		expect(initial).toMatchObject({
			theme: 'system',
			language: 'zh-CN',
			projectDir: '',
		})
		expect(initial.models.fast.contextWindow).toBeNull()
		expect(initial.models.image).toMatchObject({
			concurrency: 8,
			retries: 3,
			quality: 'high',
			nativeMaxEdge: 1536,
			postProcess: 'single',
			upscaleTier: 'anime',
		})
		expect(await readdir(userData)).toEqual([])
	})

	test('encrypts all five keys, masks reads and writes, and keeps sentinel or empty updates', async () => {
		const store = createConfigStore(userData)
		const fixtureKey = 'offline-fixture'
		const updated = await store.update({
			models: {
				fast: { apiKey: fixtureKey },
				main: { apiKey: fixtureKey },
				writing: { apiKey: fixtureKey },
				visual: { apiKey: fixtureKey },
				image: { apiKey: fixtureKey },
			},
		})
		for (const slot of Object.values(updated.models)) {
			expect(slot.apiKeyMasked).toBe(apiKeyMasked)
			expect(slot).not.toHaveProperty('apiKey')
		}
		const json = await readFile(path, 'utf8')
		expect(json).not.toContain(fixtureKey)
		const parsed = JSON.parse(json)
		const sealed = Object.values<{ apiKey: string }>(parsed.models).map(
			({ apiKey }) => apiKey,
		)
		expect(new Set(sealed).size).toBe(5)
		for (const value of sealed)
			expect(value).toMatch(/^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/)
		const reopened = createConfigStore(userData)
		expect(await reopened.get()).toEqual(updated)
		await reopened.update({
			models: {
				fast: { apiKey: apiKeyMasked, model: 'offline-text' },
				image: { apiKey: '', quality: 'medium' },
			},
		})
		expect(await reopened.resolveTextModel('fast')).toMatchObject({
			apiKey: fixtureKey,
			model: 'offline-text',
		})
		expect(await reopened.resolveImageModel()).toMatchObject({
			apiKey: fixtureKey,
			quality: 'medium',
			concurrency: 8,
		})
		await reopened.update({
			models: { image: { apiKey: 'offline-replacement' } },
		})
		expect((await reopened.resolveImageModel()).apiKey).toBe(
			'offline-replacement',
		)
	})

	test('inherits only the fast connection group and restores independent values when disabled', async () => {
		const store = createConfigStore(userData)
		const fastConnection = {
			format: 'anthropic-messages',
			compat: 'anthropic-compat',
			baseUrl: 'https://fast.example.test',
			apiKey: 'offline-fast',
		} as const
		const ownConnection = {
			format: 'openai-responses',
			compat: 'openai',
			baseUrl: 'https://own.example.test',
			apiKey: 'offline-own',
		} as const
		await store.update({
			models: {
				fast: { ...fastConnection, model: 'fast-model', contextWindow: 8192 },
				main: { ...ownConnection, model: 'main-model', contextWindow: 4096 },
				writing: { model: 'writing-model', contextWindow: 16384 },
				visual: { model: 'visual-model', contextWindow: 32768 },
				image: { baseUrl: 'https://image.example.test', model: 'image-model' },
			},
		})
		for (const [slot, contextWindow] of [
			['main', 4096],
			['writing', 16384],
			['visual', 32768],
		] as const) {
			expect(await store.resolveTextModel(slot)).toEqual({
				...fastConnection,
				model: `${slot}-model`,
				contextWindow,
			})
		}
		await store.update({ models: { main: { inheritFast: false } } })
		expect(await store.resolveTextModel('main')).toEqual({
			...ownConnection,
			model: 'main-model',
			contextWindow: 4096,
		})
		await store.update({
			models: {
				fast: { maxOutputTokens: 1024 },
				main: { inheritFast: true, maxOutputTokens: 2048 },
			},
		})
		expect(await store.resolveTextModel('fast')).toMatchObject({
			maxOutputTokens: 1024,
		})
		expect(await store.resolveTextModel('main')).toMatchObject({
			maxOutputTokens: 2048,
		})
		expect(await store.resolveTextModel('writing')).not.toHaveProperty(
			'maxOutputTokens',
		)
		expect(await store.resolveImageModel()).toMatchObject({
			baseUrl: 'https://image.example.test',
			model: 'image-model',
			apiKey: '',
		})
	})

	test('merges concurrent partial settings updates and rejects an out-of-range context without changing disk', async () => {
		const store = createConfigStore(userData)
		await Promise.all([
			store.update({
				theme: 'dark',
				projectDir: userData,
				models: { image: { nativeMaxEdge: 2816 } },
			}),
			store.update({
				models: {
					fast: { contextWindow: 4096 },
					image: { postProcess: 'double', upscaleTier: 'detail' },
				},
			}),
		])
		const saved = await readFile(path, 'utf8')
		await expect(
			store.update({ models: { fast: { contextWindow: 4095 } } }),
		).rejects.toMatchObject({ code: 'invalid_config' })
		expect(await readFile(path, 'utf8')).toBe(saved)
		expect(await readdir(userData)).toEqual(['config.json'])
		expect(await createConfigStore(userData).get()).toMatchObject({
			theme: 'dark',
			projectDir: userData,
			models: {
				fast: { contextWindow: 4096 },
				image: {
					nativeMaxEdge: 2816,
					postProcess: 'double',
					upscaleTier: 'detail',
				},
			},
		})
	})

	test.each(['invalid JSON', 'invalid fields', 'authentication failure'])(
		'preserves a broken file (%s), rejects updates, and backs it up before restoring defaults',
		async (kind) => {
			const store = createConfigStore(userData)
			const initial = await store.get()
			await store.update({ models: { fast: { apiKey: 'offline-tamper' } } })
			const config = JSON.parse(await readFile(path, 'utf8'))
			const [version, nonce, tag, ciphertext] =
				config.models.fast.apiKey.split(':')
			const broken =
				kind === 'invalid JSON'
					? '{ malformed'
					: kind === 'invalid fields'
						? JSON.stringify({ ...config, theme: 'unknown' })
						: JSON.stringify({
								...config,
								models: {
									...config.models,
									fast: {
										...config.models.fast,
										apiKey: [
											version,
											nonce,
											(tag[0] === '0' ? '1' : '0') + tag.slice(1),
											ciphertext,
										].join(':'),
									},
								},
							})
			await writeFile(path, broken)

			expect(await store.get()).toEqual({
				configError: {
					path,
					reason:
						kind === 'invalid JSON'
							? 'invalid_json'
							: kind === 'invalid fields'
								? 'invalid_fields'
								: 'decrypt_failed',
				},
			})
			await expect(store.update({ theme: 'dark' })).rejects.toMatchObject({
				code: 'invalid_config',
			})
			expect(await readFile(path, 'utf8')).toBe(broken)

			expect(await store.reset()).toEqual(initial)
			expect(await createConfigStore(userData).get()).toEqual(initial)
			const backup = (await readdir(userData)).find((name) =>
				name.startsWith('config.json.bak-'),
			)
			expect(backup).toMatch(/^config\.json\.bak-\d+$/)
			if (!backup) throw new Error('Backup not created')
			expect(await readFile(join(userData, backup), 'utf8')).toBe(broken)
		},
	)
})
