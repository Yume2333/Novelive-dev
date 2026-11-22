import { constants } from 'node:fs'
import { access, appendFile, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	type ImageCapability,
	testImage,
} from '../../../packages/creator/src/models/image/index.js'
import { imageSmokeConfig } from './smoke-config.js'

const mode = process.env.NL_REPLAY
const directory = process.env.NL_CASSETTE_DIR
if ((mode !== 'record' && mode !== 'strict') || !directory) {
	throw new Error(
		'Set NL_REPLAY=record or strict and NL_CASSETTE_DIR explicitly',
	)
}
const record = mode === 'record'
const baseUrl = record ? process.env.NL_IMAGE_BASE_URL : 'https://relay.invalid'
const apiKey = record ? process.env.NL_IMAGE_API_KEY : 'offline-placeholder'
if (!baseUrl || !apiKey)
	throw new Error('Relay credentials are not provisioned')
const config = imageSmokeConfig(baseUrl, apiKey)
const ledger = join(homedir(), 'memory/poke_5b9601/files/novelive/usage.csv')
if (record) await access(ledger, constants.W_OK)

const cacheDir = await mkdtemp(join(tmpdir(), 'novelive-image-smoke-'))
const attempted = new Set<ImageCapability>()
const requestedImages = 1
try {
	const results = await testImage(config, {
		cacheDir,
		replay: {
			mode,
			directory,
			case: 'image-connection',
			tags: ['m0-12', 'smoke'],
			fetch: async (input, init) => {
				const request = new Request(input, init)
				const url = new URL(request.url)
				if (
					!record ||
					request.method !== 'POST' ||
					url.origin !== new URL(config.baseUrl).origin
				)
					throw new Error('Unexpected image smoke HTTP request')
				let capability: ImageCapability
				if (url.pathname === '/v1/images/edits') capability = 'edit'
				else if (url.pathname === '/v1/images/generations') {
					const body = await request.clone().json()
					capability =
						body.background === 'transparent' ? 'transparent' : 'generate'
				} else throw new Error('Unexpected image smoke endpoint')
				if (attempted.has(capability))
					throw new Error('Image smoke retries are disabled')
				attempted.add(capability)
				let tokens: number | 'unknown' = 'unknown'
				let images = requestedImages
				let outcome = ' unresolved (requested image upper bound)'
				const markTimeout = (error: unknown) => {
					if (
						request.signal.aborted ||
						(error instanceof Error && /timeout/i.test(error.name))
					)
						outcome = ' unresolved/timeout (requested image upper bound)'
				}
				try {
					const response = await globalThis.fetch(request, {
						redirect: 'error',
					})
					const payload = await response
						.clone()
						.json()
						.catch((error: unknown) => {
							markTimeout(error)
							return undefined
						})
					const usage = payload?.usage?.total_tokens
					if (Number.isSafeInteger(usage) && usage >= 0) tokens = usage
					const data = Array.isArray(payload?.data) ? payload.data : []
					const returnedImages = data.filter(
						(image: { b64_json?: string; url?: string }) =>
							image?.b64_json || image?.url,
					).length
					if (payload !== undefined) {
						images = returnedImages
						outcome = ''
					}
					if (response.ok && (!returnedImages || !data[0]?.b64_json))
						throw new Error('Smoke recording requires an inline image')
					if (!response.ok)
						console.error(`record ${capability}: HTTP ${response.status}`)
					return response
				} catch (error) {
					markTimeout(error)
					throw error
				} finally {
					await appendFile(
						ledger,
						`${new Date().toISOString().slice(0, 10)},${config.model},1,${tokens},${images},M0/12 ${capability} connection smoke${outcome}\n`,
					)
				}
			},
		},
	})
	for (const [capability, result] of Object.entries(results)) {
		console.log(
			`${mode} ${capability}: ${result.ok ? 'passed' : result.error.code}`,
		)
		if (!result.ok) process.exitCode = 1
	}
} finally {
	await rm(cacheDir, { recursive: true, force: true })
}
