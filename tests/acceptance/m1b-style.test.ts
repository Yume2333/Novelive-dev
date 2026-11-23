import { createHash } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arr, compile, int, obj, str } from '@earendil-works/pi-schema'
import OpenAI from 'openai'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { imageRenderer } from '../../packages/creator/src/pipeline/art/models'
import {
	type Drawing,
	drawingPrompt,
} from '../../packages/creator/src/pipeline/art/prompt'
import { createReplayFetch } from '../../packages/creator/src/replay'
import type { Character } from '../../packages/format/src/model'

const root = join(homedir(), '.local/novelive-tools/m1b-style')
const ledger = join(homedir(), 'memory/poke_5b9601/files/novelive/usage.csv')
const purpose = 'M1b/10 FXB'
const imageModel = 'gpt-image-2.6-sunburst'
const judgeModel = 'gemini-3.8-flash'
const reserve = 100_000
const budget = { tokens: 2_000_000, images: 30 }
const palette = {
	hair: 'ash-blonde short hair',
	eyes: 'green eyes',
	clothing: 'cream sweater, white collar, long dark green skirt',
}
const description =
	'Short wavy ash-blonde hair parted on the side, silver star clip above the left ear, green eyes, thin round gold-rimmed glasses, loose cream cable-knit sweater over a white collared shirt and a long dark green pleated skirt.'
const scene =
	'A small cafe in the afternoon, empty except for one young adult. Warm sunlight enters a large window on the left. A white coffee cup and cake rest on the table; plants sit on the windowsill and shelves of glass jars line the back wall. In a three-quarter view she looks down with a soft, focused expression and writes in a brown leather notebook by the window. Her right hand holds the pen; her left rests beside the cup. No other people.'
const character = {
	id: 'cafe-writer',
	name: 'Cafe writer',
	aliases: [],
	status: 'confirmed',
	appearance: { description, keyColors: palette },
} satisfies Character
const sources = [
	[
		'shalott.jpg',
		'85285c9ec190a51331d88367f68867611aaabd65dcd7f6ca45aca119511be3a9',
	],
	[
		'circe.jpg',
		'38f665cc0c9b32cacd1da11797c499a4057a1a8ec348a47b57e5c051768359c1',
	],
	[
		'rose.jpg',
		'46db09b635f0e143578a4f5b9522fd4a8936410cd9d9dd63998448bc35b641dc',
	],
] as const
const arms = [
	{ name: 'single', references: 1, lock: false },
	{ name: 'single-lock', references: 1, lock: true },
	{ name: 'triple-lock', references: 3, lock: true },
] as const

const score = int({ minimum: 0, maximum: 4 })
const review = compile(
	obj({
		scores: arr(
			obj({
				id: str(),
				style: score,
				anchor: score,
				composition: score,
				note: str(),
			}),
			{ minItems: 3, maxItems: 3 },
		),
	}),
)

test.skipIf(
	!(
		process.env.NL_REPLAY === 'record' ||
		(process.env.NL_REPLAY === 'strict' && process.env.NL_STYLE_REPLAY === '1')
	),
)(
	'M1b/10 compares three FXB arms with fixed scene and character and blind vision scores',
	async () => {
		const mode = process.env.NL_REPLAY
		const baseURL =
			mode === 'record'
				? process.env.NL_IMAGE_BASE_URL
				: 'https://relay.invalid/v1'
		const apiKey = mode === 'record' ? process.env.NL_IMAGE_API_KEY : 'offline'
		if (!baseURL || !apiKey)
			throw new Error('The provisioned relay environment is unavailable')
		const endpoint = new URL(baseURL)
		if (endpoint.pathname === '/') endpoint.pathname = '/v1'
		const totals = { tokens: 0, images: 0, calls: 0 }
		const thisRun = { tokens: 0, images: 0, calls: 0, reserved: 0 }
		if (mode === 'record') {
			for (const line of (await readFile(ledger, 'utf8')).split('\n')) {
				const [, , calls, tokens, images, reason] = line.split(',')
				if (!reason?.startsWith(purpose)) continue
				totals.calls += Number(calls)
				totals.tokens += Number(tokens)
				totals.images += Number(images)
			}
		}
		const paidFetch: typeof globalThis.fetch = async (input, init) => {
			if (mode !== 'record')
				throw new Error('Strict comparison cannot call upstream')
			const request = new Request(input, init)
			const path = new URL(request.url).pathname
			const image = path.endsWith('/images/edits')
			const model = image ? imageModel : judgeModel
			if (
				request.method !== 'POST' ||
				(!image && !path.endsWith('/chat/completions'))
			)
				throw new Error('Unexpected comparison provider request')
			if (
				totals.tokens + reserve > budget.tokens ||
				totals.images + Number(image) > budget.images
			)
				throw new Error('M1b/10 budget exhausted')
			totals.tokens += reserve
			totals.images += Number(image)
			totals.calls++
			thisRun.images += Number(image)
			thisRun.calls++
			let measured: number | undefined
			try {
				const response = await fetch(request)
				if (response.ok) {
					const { usage } = await response.clone().json()
					const tokens =
						usage?.total_tokens ??
						(usage?.input_tokens ?? usage?.prompt_tokens) +
							(usage?.output_tokens ?? usage?.completion_tokens)
					if (Number.isSafeInteger(tokens) && tokens > 0) measured = tokens
				} else {
					console.error(`${model} HTTP ${response.status}`)
				}
				return response
			} catch {
				throw new Error(`${model} request did not complete`)
			} finally {
				const tokens = measured ?? reserve
				totals.tokens += tokens - reserve
				thisRun.tokens += tokens
				thisRun.reserved += Number(measured === undefined)
				await appendFile(
					ledger,
					`${new Date().toISOString().slice(0, 10)},${model},1,${tokens},${Number(image)},${purpose}${measured === undefined ? ' (reserved upper bound)' : ''}\n`,
				)
			}
		}
		const replay = {
			directory: join(root, 'cassette'),
			case: 'm1b-style',
			fetch: paidFetch,
		}
		const render = imageRenderer(
			{
				baseUrl: endpoint.href,
				apiKey,
				model: imageModel,
				quality: 'high',
				concurrency: 1,
				retries: 0,
				nativeMaxEdge: 1536,
				postProcess: 'off',
				upscaleTier: 'anime',
			},
			{ replay },
		)
		const references = await Promise.all(
			sources.map(async ([path, checksum]) => {
				const bytes = await readFile(join(root, 'refs', path))
				expect(createHash('sha256').update(bytes).digest('hex')).toBe(checksum)
				return sharp(bytes)
					.rotate()
					.resize(900, 900, { fit: 'inside', withoutEnlargement: true })
					.png()
					.toBuffer()
			}),
		)
		const drawn: { arm: string; bytes: Buffer }[] = []
		try {
			for (const arm of arms) {
				const refs = references.slice(0, arm.references)
				const drawing: Drawing = {
					kind: 'cg',
					description: scene,
					style: '',
					keep: [],
					characters: [
						arm.lock
							? character
							: { ...character, appearance: { description } },
					],
					references: refs.map((_, i) => ({
						path: sources[i][0],
						role: 'style',
						label: 'style',
					})),
				}
				const result = await render(
					drawingPrompt(drawing, scene, ''),
					refs,
					{ width: 1536, height: 864 },
					false,
				)
				if ('error' in result)
					throw new Error(`${arm.name} image failed: ${result.error.code}`)
				await writeFile(join(root, `${arm.name}.png`), result.bytes)
				drawn.push({ arm: arm.name, bytes: result.bytes })
			}
			const order = [drawn[2], drawn[0], drawn[1]]
			const blind = order.map((row, i) => ({
				...row,
				id: String.fromCharCode(65 + i),
			}))
			const image = async (bytes: Buffer) => ({
				type: 'image_url' as const,
				image_url: {
					url: `data:image/jpeg;base64,${(await sharp(bytes).resize(900, 900, { fit: 'inside' }).jpeg({ quality: 90 }).toBuffer()).toString('base64')}`,
				},
			})
			const client = new OpenAI({
				baseURL: endpoint.href,
				apiKey,
				maxRetries: 0,
				timeout: 90_000,
				fetch: createReplayFetch(replay),
			})
			const answer = await client.chat.completions
				.create({
					model: judgeModel,
					max_tokens: 4_096,
					temperature: 0,
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'text',
									text: `The first three images are a style panel. Then A, B and C are anonymous independent candidates for the same brief. Score each from 0 (absent) to 4 (excellent) on style (line/paint/lighting/texture, not copied subject), anchor (verify every described trait and whether source identity/wardrobe leaked; mark hidden traits unverifiable), and composition (scene, action and framing). Be specific about color drift and whether a trait is visible. Scene: ${scene} Character: ${description} Return JSON only: {"scores":[{"id":"A","style":0,"anchor":0,"composition":0,"note":"..."}]} with exactly A, B, C.`,
								},
								...(await Promise.all(references.map(image))),
								...(await Promise.all(
									blind.map(async ({ id, bytes }) => [
										{ type: 'text' as const, text: id },
										await image(bytes),
									]),
								).then((items) => items.flat())),
							],
						},
					],
				})
				.catch(() => {
					throw new Error('Blind visual review request failed')
				})
			const json: unknown = JSON.parse(
				(answer.choices[0]?.message.content ?? '')
					.trim()
					.replace(/^```(?:json)?\s*|\s*```$/g, ''),
			)
			expect(review.check(json)).toBe(true)
			if (!review.check(json)) throw new Error('Invalid blind score schema')
			expect(json.scores.map(({ id }) => id).sort()).toEqual(['A', 'B', 'C'])
			const scores = blind.map(({ id, arm }) => ({
				arm,
				...json.scores.find((row) => row.id === id),
			}))
			await writeFile(
				join(root, 'redact-ready.json'),
				JSON.stringify({ scores, thisRun, totals }, null, 2),
			)
			console.log(JSON.stringify({ scores, thisRun, totals }))
		} finally {
			console.log(`M1b/10 usage: ${JSON.stringify({ thisRun, totals })}`)
		}
	},
	420_000,
)
