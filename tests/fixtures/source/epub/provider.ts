import assert from 'node:assert/strict'
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { classifyIllustrations } from '../../../../packages/creator/src/import/epub/illustrations'
import {
	createReplayFetch,
	type ReplayOptions,
} from '../../../../packages/creator/src/replay'
import {
	classificationCases,
	classificationExtraction,
	syntheticDirectory,
	visualConnection,
} from './classification'

export const privateRoot = join(homedir(), '.local/novelive-epub-provider')

export function providerReplay(
	directory: string,
	fetch: typeof globalThis.fetch,
	name: string,
): ReplayOptions {
	return {
		mode: 'replay',
		directory,
		fetch: createReplayFetch({
			mode: 'record',
			directory,
			fetch: async (input, init) => {
				const response = await fetch(input, init)
				if (!response.ok)
					throw new Error(
						`Provider HTTP ${response.status}; response not recorded`,
					)
				return response
			},
			case: name,
			tags: ['private-provider', 'm4-02'],
		}),
	}
}

export function providerUsage(
	value:
		| {
				prompt_tokens?: number
				completion_tokens?: number
				total_tokens?: number
		  }
		| undefined,
) {
	if (
		!value ||
		!Number.isSafeInteger(value.prompt_tokens) ||
		!Number.isSafeInteger(value.completion_tokens) ||
		(value.prompt_tokens ?? -1) < 0 ||
		(value.completion_tokens ?? -1) < 0
	)
		return undefined
	const inputTokens = value.prompt_tokens as number
	const outputTokens = value.completion_tokens as number
	const measured = inputTokens + outputTokens
	if (measured <= 0) return undefined
	const total =
		Number.isSafeInteger(value.total_tokens) &&
		(value.total_tokens ?? 0) >= measured
			? (value.total_tokens as number)
			: measured
	return { inputTokens, outputTokens, total }
}

export async function runProviderCases(
	mode: 'record' | 'strict' | 'synthetic',
) {
	const record = mode === 'record'
	const baseUrl = record
		? process.env.NL_IMAGE_BASE_URL &&
			new URL('/v1', process.env.NL_IMAGE_BASE_URL).href
		: visualConnection.baseUrl
	const apiKey = record ? process.env.NL_IMAGE_API_KEY : visualConnection.apiKey
	assert.ok(baseUrl && apiKey, 'Recording credentials must be provisioned')
	const directory =
		mode === 'synthetic'
			? syntheticDirectory
			: (process.env.NL_EPUB_CASSETTE_DIR ?? join(privateRoot, 'cassette'))
	const ledger = join(homedir(), 'memory/poke_5b9601/files/novelive/usage.csv')
	const receipts: object[] = []
	const receiptPath = join(privateRoot, `receipt-${Date.now()}.json`)
	if (record) await mkdir(privateRoot, { recursive: true })
	if (mode === 'synthetic') {
		await mkdir(syntheticDirectory, { recursive: true })
		await rm(join(syntheticDirectory, 'cassette.jsonl'), { force: true })
		for (const sample of classificationCases) {
			await sharp(
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${sample.svg}</svg>`,
				),
			)
				.png()
				.toFile(join(syntheticDirectory, `${sample.label}.png`))
		}
	}
	for (const sample of classificationCases) {
		let calls = 0
		const fetch: typeof globalThis.fetch = async (input, init) => {
			if (mode === 'synthetic') {
				const content = JSON.stringify({
					label: sample.label,
					reason: 'Synthetic classification fixture; not a provider response.',
				})
				return new Response(
					`data: ${JSON.stringify({ id: 'epub-synthetic', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'epub-synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`,
					{ headers: { 'content-type': 'text/event-stream' } },
				)
			}
			assert.ok(record, 'Strict replay must not access network')
			assert.equal(calls++, 0, 'Only one paid call is authorized per case')
			const request = new Request(input, init)
			assert.equal(new URL(request.url).origin, new URL(baseUrl).origin)
			let inputTokens: number | undefined
			let outputTokens: number | undefined
			let total = 40_000
			try {
				const response = await globalThis.fetch(request, {
					redirect: 'error',
					signal: AbortSignal.timeout(120_000),
				})
				const events = (await response.clone().text())
					.split('\n')
					.filter(
						(line) => line.startsWith('data: ') && !line.includes('[DONE]'),
					)
					.map((line) => JSON.parse(line.slice(6)))
				const usage = providerUsage(
					events.findLast((event) => event.usage)?.usage,
				)
				if (usage) {
					inputTokens = usage.inputTokens
					outputTokens = usage.outputTokens
					total = usage.total
				}
				return response
			} finally {
				await appendFile(
					ledger,
					`${new Date().toISOString().slice(0, 10)},${visualConnection.model},1,${total},0,M4/02 EPUB ${sample.label} input=${inputTokens ?? 'unknown'} output=${outputTokens ?? 'unknown'} input_images=1${inputTokens === undefined ? ' reserved upper bound' : ''}\n`,
				)
				receipts.push({
					label: sample.label,
					calls: 1,
					inputTokens,
					outputTokens,
					total,
					inputImages: 1,
					generatedImages: 0,
				})
				await writeFile(receiptPath, JSON.stringify(receipts, null, 2))
			}
		}
		const candidates = await classifyIllustrations(
			classificationExtraction(sample),
			sample.bible,
			{ ...visualConnection, baseUrl, apiKey },
			{
				replay: record
					? providerReplay(directory, fetch, `epub-${sample.label}`)
					: {
							mode: mode === 'strict' ? 'strict' : 'record',
							directory,
							fetch,
							case: `epub-${sample.label}`,
							tags: [
								mode === 'synthetic'
									? 'synthetic-not-provider'
									: 'private-provider',
								'm4-02',
							],
						},
			},
		)
		assert.equal(candidates[0].label, sample.label)
		assert.equal(candidates[0].selected, false)
		console.log(`${mode} EPUB ${sample.label}: passed`)
	}
	if (record) console.log(JSON.stringify(receipts))
}
