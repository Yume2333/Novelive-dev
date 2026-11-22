import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { TextConnection } from '../../../../packages/creator/src/models/text'
import { ArtProduction } from '../../../../packages/creator/src/pipeline/art'
import { Project } from '../../../../packages/creator/src/project'
import { createReplayFetch } from '../../../../packages/creator/src/replay'
import { bible, projectSeed } from './fixture'

function replayMode() {
	const mode = process.env.NL_REPLAY
	if (mode !== 'record' && mode !== 'strict')
		throw new Error('Set NL_REPLAY=record or NL_REPLAY=strict.')
	return mode
}

const mode = replayMode()

const root = join(homedir(), '.local/novelive-tools/m1b-art-provider')
const directory = join(root, 'cassette')
const ledger = join(homedir(), 'memory/poke_5b9601/files/novelive/usage.csv')
const imageModel = 'gpt-image-2.6-sunburst'
const mainModel = 'devin-swe-2'
const fastModel = 'deepseek-v4.1-flash'
const visualModel = 'gemini-3.8-flash'
const reservation = 48_000
const imageLimit = 12
let calls = 0
let images = 0
let tokens = 0
let estimated = 0
let previousImages = 0
let previousTokens = 0

function usage(body: string, streaming: boolean) {
	const events = streaming
		? body
				.split('\n')
				.filter((line) => line.startsWith('data:') && !line.includes('[DONE]'))
				.map((line) => JSON.parse(line.slice(5)))
		: [JSON.parse(body)]
	const value = events.findLast((event) => event.usage)?.usage
	const total =
		value?.total_tokens ?? value?.prompt_tokens + value?.completion_tokens
	return Number.isSafeInteger(total) && total > 0 ? Number(total) : undefined
}

const paidFetch: typeof globalThis.fetch = async (input, init) => {
	if (mode !== 'record')
		throw new Error('Offline art smoke cannot call upstream')
	const request = new Request(input, init)
	const isImage = /\/images\/(generations|edits)$/.test(
		new URL(request.url).pathname,
	)
	const multipart = request.headers
		.get('content-type')
		?.startsWith('multipart/')
	const body = request.clone()
	const model = multipart
		? (await body.formData()).get('model')
		: (await body.json()).model
	if (
		isImage
			? model !== imageModel
			: ![mainModel, fastModel, visualModel].includes(model)
	)
		throw new Error('Unexpected provider model')
	if (
		previousTokens + tokens + reservation > 1_000_000 ||
		(isImage && previousImages + images >= imageLimit)
	)
		throw new Error('Provider recording allocation reached')
	calls++
	if (isImage) images++
	tokens += reservation
	let total: number | undefined
	try {
		const response = await globalThis.fetch(request)
		if (response.ok) {
			try {
				total = usage(
					await response.clone().text(),
					response.headers.get('content-type')?.includes('text/event-stream') ??
						false,
				)
			} catch {
				// Keep the reservation if provider usage was not parseable.
			}
		} else console.error(`Provider HTTP ${response.status} for ${model}`)
		return response
	} finally {
		if (total === undefined) estimated++
		tokens += (total ?? reservation) - reservation
		await appendFile(
			ledger,
			`${new Date().toISOString().slice(0, 10)},${model},1,${total ?? reservation},${isImage ? 1 : 0},M1b/03 art smoke${total === undefined ? ' (reserved upper bound)' : ''}\n`,
		)
	}
}

const recordMissing: typeof globalThis.fetch = (input, init) => {
	const request = new Request(input, init)
	return createReplayFetch({
		mode: 'record',
		directory,
		case: 'm1b-art-provider',
		fetch:
			request.method === 'GET'
				? (recordedRequest) => globalThis.fetch(recordedRequest, init)
				: paidFetch,
	})(request)
}

async function run() {
	const baseUrl =
		mode === 'record'
			? process.env.NL_IMAGE_BASE_URL
			: 'https://relay.invalid/v1'
	const apiKey = mode === 'record' ? process.env.NL_IMAGE_API_KEY : 'offline'
	if (!baseUrl || !apiKey)
		throw new Error('Recording requires the provisioned relay environment.')
	if (mode === 'record') {
		for (const line of (await readFile(ledger, 'utf8')).split('\n')) {
			const [, , , tokens, images, purpose] = line.split(',')
			if (purpose?.startsWith('M1b/03 art smoke')) {
				previousTokens += Number(tokens)
				previousImages += Number(images)
			}
		}
	}
	const url = new URL(baseUrl)
	if (url.pathname === '/') url.pathname = '/v1'
	const connection = {
		baseUrl: url.href,
		apiKey,
		contextWindow: 16_384,
		format: 'openai-completions',
		compat: 'auto',
	} satisfies Omit<TextConnection, 'model'>
	await mkdir(root, { recursive: true, mode: 0o700 })
	const dir = await mkdtemp(join(root, 'project-'))
	try {
		using project = await Project.create(join(dir, 'work'), {
			...projectSeed,
			volumeIds: ['v1'],
		})
		const art = new ArtProduction(project, {
			replay: {
				mode: mode === 'record' ? 'replay' : 'strict',
				directory,
				fetch: mode === 'record' ? recordMissing : paidFetch,
			},
			main: { ...connection, model: mainModel },
			fast: { ...connection, model: fastModel },
			visual: { ...connection, model: visualModel },
			image: {
				baseUrl: connection.baseUrl,
				apiKey,
				model: imageModel,
				nativeMaxEdge: 1536,
				concurrency: 1,
				retries: 1,
				quality: 'medium',
				postProcess: 'off',
				upscaleTier: 'anime',
			},
		})
		const pool = await art.candidates(bible, [])
		console.log(`Key visual candidates: ${pool.mainVisuals.length}`)
		const style = await art.confirmVisual(bible.style, pool, {
			mainVisualId: 'visual-1',
			supplementalIds: [],
			characters: [],
		})
		const confirmed = { ...bible, style }
		const jobs = await art.register(
			[
				{
					id: 'ada/uniform/angry',
					kind: 'expression',
					description: 'Ada narrows her eyes in frustration',
				},
				{
					id: 'room/day',
					kind: 'location',
					description: 'Quiet classroom in afternoon light',
				},
				{
					id: 'cg-window',
					kind: 'cg',
					description:
						'Ada stands next to the classroom window and watches the falling rain',
				},
			],
			confirmed,
		)
		const drawn = new Set<string>()
		for (const job of jobs) {
			if (
				job.kind === 'cg' &&
				(!drawn.has('ada/uniform/neutral') || !drawn.has('room/day'))
			) {
				console.error(
					`${job.assetId}: skipped because a reference was not drawn`,
				)
				process.exitCode = 1
				continue
			}
			const result = await art.draw(
				job,
				confirmed,
				job.kind === 'cg'
					? {
							costumes: ['ada/uniform/neutral'],
							location: 'room/day',
						}
					: undefined,
			)
			console.log(`${job.assetId}: ${result.status}`)
			if (result.status !== 'drawn') {
				console.error(result.issue)
				process.exitCode = 1
				continue
			}
			drawn.add(job.assetId)
			const entry = (await art.registry()).entries.find(
				({ id }) => id === job.assetId,
			)
			if (!entry) throw new Error('Missing drawn asset registry entry')
			const metadata = await sharp(
				await project.readFile(entry.path),
			).metadata()
			if (
				metadata.format !== 'webp' ||
				((job.kind === 'character' || job.kind === 'expression') &&
					!metadata.hasAlpha)
			)
				throw new Error('Unexpected output format or missing portrait alpha')
		}
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

try {
	await run()
} catch (error) {
	console.error(
		mode === 'record'
			? `Art recording stopped: ${error instanceof Error ? error.name : 'unknown error'}`
			: error,
	)
	process.exitCode = 1
} finally {
	console.log(
		`Paid usage: ${calls} calls, ${tokens} tokens (${estimated} estimated), ${images} images including reservations.`,
	)
}
