import { appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createReplayFetch } from '../../packages/creator/src/replay'
import { cases } from '../../tests/fixtures/quality/cases'
import { evaluate } from './scorer'

const model = 'deepseek-v4.1-flash'
const contextWindow = 16_384
const directory = 'tests/fixtures/quality'

export function evaluateFixtures(
	mode: 'strict' | 'record',
	endpoint = { baseUrl: 'https://relay.invalid/v1', apiKey: 'offline' },
	fetch?: typeof globalThis.fetch,
) {
	return evaluate(
		cases,
		{
			...endpoint,
			model,
			contextWindow,
			format: 'openai-completions',
			compat: 'auto',
		},
		createReplayFetch({
			directory,
			mode,
			fetch,
			case: 'm1b-quality',
			tags: ['synthetic-source'],
		}),
	)
}

async function main() {
	const mode = process.env.NL_REPLAY
	if (mode !== 'strict' && mode !== 'record')
		throw new Error('Set NL_REPLAY=strict or NL_REPLAY=record.')
	if (mode === 'strict') {
		const report = await evaluateFixtures(mode)
		console.log(JSON.stringify(report, null, 2))
		if (report.summary.undecided) process.exitCode = 1
		return
	}
	const { NL_IMAGE_BASE_URL: baseUrl, NL_IMAGE_API_KEY: apiKey } = process.env
	if (!baseUrl || !apiKey)
		throw new Error('Recording requires the provisioned relay environment.')
	const url = new URL(baseUrl)
	if (url.pathname === '/') url.pathname = '/v1'
	const ledger = join(homedir(), 'memory/poke_5b9601/files/novelive/usage.csv')
	await appendFile(ledger, '', { flag: 'a' })
	let calls = 0
	let tokens = 0
	const fetch: typeof globalThis.fetch = async (input, init) => {
		if (calls >= cases.length)
			throw new Error('Quality recording call allocation reached')
		calls++
		let total: number | undefined
		try {
			const response = await globalThis.fetch(input, init)
			for (const line of (await response.clone().text()).split('\n')) {
				if (!line.startsWith('data:') || line.includes('[DONE]')) continue
				const { usage } = JSON.parse(line.slice(5))
				const value =
					usage?.total_tokens ?? usage?.prompt_tokens + usage?.completion_tokens
				if (Number.isSafeInteger(value) && value > 0) total = value
			}
			return response
		} finally {
			const reserved = total ?? contextWindow
			tokens += reserved
			await appendFile(
				ledger,
				`${new Date().toISOString().slice(0, 10)},${model},1,${reserved},0,M1b/08 synthetic quality judge${total === undefined ? ' (reserved upper bound)' : ''}\n`,
			)
		}
	}
	const report = await evaluateFixtures(
		mode,
		{ baseUrl: url.href, apiKey },
		fetch,
	)
	console.log(JSON.stringify(report, null, 2))
	console.log(`Paid usage: ${calls} calls, ${tokens} tokens, 0 images.`)
	if (report.summary.undecided) process.exitCode = 1
}

if (process.argv[1] === import.meta.filename) await main()
