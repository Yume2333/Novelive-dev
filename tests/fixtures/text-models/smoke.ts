import { constants } from 'node:fs'
import { access, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
	TextModelError,
	testTextConnection,
} from '../../../packages/creator/src/models/text/index.js'
import { createReplayFetch } from '../../../packages/creator/src/replay/index.js'
import { smokeConnection, smokeProfiles } from './smoke-config.js'

const mode = process.env.NL_REPLAY
if ((mode !== 'record' && mode !== 'strict') || !process.env.NL_CASSETTE_DIR) {
	throw new Error(
		'Set NL_REPLAY=record or strict and NL_CASSETTE_DIR explicitly',
	)
}
const record = mode === 'record'
const baseUrl = record ? process.env.NL_IMAGE_BASE_URL : 'https://relay.invalid'
const apiKey = record ? process.env.NL_IMAGE_API_KEY : 'offline-placeholder'
if (!baseUrl || !apiKey)
	throw new Error('Relay credentials are not provisioned')
const ledger = join(homedir(), 'memory/poke_5b9601/files/novelive/usage.csv')
if (record) await access(ledger, constants.W_OK)

for (const profile of smokeProfiles) {
	let calls = 0
	let tokens = 'unknown'
	try {
		const fetch = createReplayFetch({
			case: profile.format,
			tags: ['m0-07', 'smoke'],
			fetch: async (input, init) => {
				if (!record || calls !== 0)
					throw new Error('Unexpected smoke HTTP request')
				if (
					new URL(input instanceof Request ? input.url : input).origin !==
					new URL(baseUrl).origin
				) {
					throw new Error('Smoke request must stay on the configured relay')
				}
				calls++
				return globalThis.fetch(input, { ...init, redirect: 'error' })
			},
		})
		const { usage } = await testTextConnection(
			smokeConnection(profile, baseUrl, apiKey),
			{
				image: profile.image,
				fetch,
				requestRetries: 0,
				streamRetries: 0,
			},
		)
		if (usage.totalTokens > 0) tokens = String(usage.totalTokens)
		console.log(
			`${mode} ${profile.format} ${profile.model}: passed; ${tokens} tokens`,
		)
	} catch (error) {
		if (
			error instanceof TextModelError &&
			error.usage &&
			error.usage.totalTokens > 0
		)
			tokens = String(error.usage.totalTokens)
		console.error(
			`${mode} ${profile.format} ${profile.model}: ${error instanceof TextModelError ? error.code : 'internal'}; ${tokens} tokens`,
		)
		process.exitCode = 1
	} finally {
		if (record && calls) {
			await appendFile(
				ledger,
				`${new Date().toISOString().slice(0, 10)},${profile.model},${calls},${tokens},0,M0/07 ${profile.format} connection smoke\n`,
			)
		}
	}
}
