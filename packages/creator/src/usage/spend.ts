import { createHash } from 'node:crypto'
import { addAbortListener } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { reserveTokenFields } from './reservation'

export class SpendBudgetError extends Error {
	readonly code = 'invalid_config'

	constructor(detail: string) {
		super(`已停止模型请求：${detail}`)
	}
}

const valid = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const textSettlements = new WeakMap<Response, () => boolean>()
const imageSettlements = new WeakSet<Response>()

export function hasSettledImage(response: Response) {
	return imageSettlements.has(response)
}

function definiteRejection(status: number) {
	return status >= 400 && status < 500 && status !== 408 && status !== 409
}

export function textSettlement(response: Response) {
	return textSettlements.get(response)
}

export function inheritSettlement(source: Response, target: Response) {
	const settlement = textSettlement(source)
	if (settlement) textSettlements.set(target, settlement)
	if (hasSettledImage(source)) imageSettlements.add(target)
	return target
}

function cap(value: string | undefined, name: string) {
	const amount = Number(value)
	if (!value || !/^\d+$/.test(value) || !valid(amount))
		throw new SpendBudgetError(`请设置有效的 ${name}（非负整数）`)
	return amount
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

function outputFactor(model: unknown) {
	const name = 'NL_RUN_OUTPUT_OVERSHOOT_FACTORS'
	const raw = process.env[name]
	if (raw !== undefined) {
		try {
			const value: unknown = JSON.parse(raw)
			const factors = object(value)
			if (
				factors !== value ||
				Object.values(factors).some((factor) => !valid(factor) || factor < 1)
			)
				throw new Error()
			if (typeof model === 'string' && Object.hasOwn(factors, model))
				return factors[model] as number
		} catch {
			throw new SpendBudgetError(
				`请将 ${name} 设置为模型名到正整数的 JSON 对象`,
			)
		}
	}
	return model === 'devin-swe-2' ? 5 : 1
}

function softTokenLimit(tokenCap: number) {
	const name = 'NL_RUN_TOKEN_SOFT_FRACTION'
	const raw = process.env[name] ?? '0.8'
	const [, whole, decimal = ''] = /^(\d*)(?:\.(\d+))?$/.exec(raw) ?? []
	const denominator = 10n ** BigInt(decimal.length)
	const numerator = BigInt((whole ?? '') + decimal)
	if (numerator <= 0n || numerator > denominator)
		throw new SpendBudgetError(`请将 ${name} 设置为大于 0 且不超过 1 的小数`)
	return Number((BigInt(tokenCap) * numerator + denominator - 1n) / denominator)
}

function totalUsage(value: unknown) {
	const usage = object(value)
	const input = usage.prompt_tokens ?? usage.input_tokens
	const output = usage.completion_tokens ?? usage.output_tokens
	const total =
		usage.total_tokens ??
		(valid(input) && valid(output) ? input + output : undefined)
	return valid(total) && total > 0 ? total : undefined
}

export function requestedOutputTokens(
	request: Request,
	body: Record<string, unknown>,
) {
	return new URL(request.url).pathname.replace(/\/$/, '').endsWith('/responses')
		? body.max_output_tokens
		: (body.max_completion_tokens ?? body.max_tokens)
}

function imagePartData(part: Record<string, unknown>): string | undefined {
	if (part.type === 'image_url' || part.type === 'input_image') {
		const url =
			typeof part.image_url === 'string'
				? part.image_url
				: object(part.image_url).url
		const prefix =
			typeof url === 'string' && /^data:image\/[\w.+-]+;base64,/i.exec(url)
		if (typeof url !== 'string' || !prefix) throw new Error()
		return url.slice(prefix[0].length)
	}
	if (part.type === 'image') {
		const source = object(part.source)
		if (
			source.type !== 'base64' ||
			typeof source.media_type !== 'string' ||
			!source.media_type.startsWith('image/') ||
			typeof source.data !== 'string'
		)
			throw new Error()
		return source.data
	}
}

async function reserveImage(data: string) {
	const { format, width, height, pages } = await sharp(
		Buffer.from(data, 'base64'),
	).metadata()
	if (
		!width ||
		!height ||
		!['png', 'jpeg', 'webp', 'gif'].includes(format ?? '') ||
		(pages ?? 1) !== 1
	)
		throw new Error()
	const tiles = (edge: number) => Math.max(2, Math.ceil(edge / 512))
	return 4096 + 8192 * tiles(width) * tiles(height)
}

export async function quoteSpend(request: Request) {
	const path = new URL(request.url).pathname.replace(/\/$/, '')
	try {
		if (request.method !== 'POST') throw new Error()
		if (/\/images\/(?:generations|edits)$/.test(path)) {
			const multipart = request.headers
				.get('content-type')
				?.startsWith('multipart/')
			const form = multipart ? await request.clone().formData() : undefined
			const body = form ? undefined : object(await request.clone().json())
			const n = (form ? form.get('n') : body?.n) ?? 1
			const model = form ? form.get('model') : body?.model
			const count = typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n
			if (!valid(count) || count < 1) throw new Error()
			const perImage = cap(
				process.env.NL_RUN_IMAGE_TOKEN_RESERVE ?? '7000',
				'NL_RUN_IMAGE_TOKEN_RESERVE',
			)
			const sunburst = model === 'gpt-image-2.6-sunburst'
			const images = count * (sunburst ? 3 : 1)
			const tokens = Math.max(images * perImage, sunburst ? count * 31_000 : 0)
			if (!perImage || !valid(tokens) || !valid(images)) throw new Error()
			return { tokens, images }
		}
		const responses = path.endsWith('/responses')
		if (!responses && !/\/(?:chat\/completions|messages)$/.test(path))
			throw new Error()
		const body = object(await request.clone().json())
		const output = requestedOutputTokens(request, body)
		const inputKey = responses ? 'input' : 'messages'
		const input = body[inputKey]
		if (
			!valid(output) ||
			output < 1 ||
			(!Array.isArray(input) && !(responses && typeof input === 'string'))
		)
			throw new Error()
		const outputReserve = output * outputFactor(body.model)
		if (!valid(outputReserve)) throw new Error()
		const fields: string[] = []
		const images: string[] = []
		let largeFieldBytes = 0
		function collect(
			value: unknown,
			level: 'body' | 'messages' | 'parts' | 'field' = 'field',
		) {
			if (typeof value === 'string' && value.length > 16_384) {
				largeFieldBytes += Buffer.byteLength(value)
			} else if (Array.isArray(value)) {
				for (const item of value) collect(item, level)
			} else if (value && typeof value === 'object') {
				if (level === 'parts' || (responses && level === 'messages')) {
					const data = imagePartData(object(value))
					if (data !== undefined) {
						images.push(data)
						return
					}
				}
				for (const [key, item] of Object.entries(value)) {
					fields.push(key)
					collect(
						item,
						level === 'body' && key === inputKey
							? 'messages'
							: (level === 'messages' || level === 'parts') &&
									(key === 'content' || (responses && key === 'output')) &&
									Array.isArray(item)
								? 'parts'
								: 'field',
					)
				}
			} else {
				fields.push(String(value))
			}
		}
		collect(body, 'body')
		let vision = 0
		for (const data of images) vision += await reserveImage(data)
		const tokens =
			reserveTokenFields(fields, outputReserve).reserved +
			largeFieldBytes +
			vision
		if (!valid(tokens)) throw new Error()
		return { tokens, images: 0 }
	} catch (error) {
		if (error instanceof SpendBudgetError) throw error
		throw new SpendBudgetError('无法核算此模型请求的预算')
	}
}

export function isResponsesTerminal(type: unknown) {
	return (
		type === 'response.completed' ||
		type === 'response.incomplete' ||
		type === 'response.failed'
	)
}

function observeUsage(response: Response, settle: (tokens: number) => void) {
	if (!response.body) return response
	let pending = ''
	let anthropicInput: number | undefined
	let anthropicOutput: number | undefined
	const decoder = new TextDecoder()
	function line(text: string) {
		if (!text.startsWith('data:')) return
		const data = text.slice(5).trim()
		if (data === '[DONE]') return
		let row: Record<string, unknown>
		try {
			row = object(JSON.parse(data))
		} catch {
			return
		}
		const usage = totalUsage(row.usage)
		if (usage !== undefined) settle(usage)
		if (isResponsesTerminal(row.type)) {
			const total = totalUsage(object(row.response).usage)
			if (total !== undefined) settle(total)
		}
		if (row.type === 'message_start') {
			const usage = object(object(row.message).usage)
			const parts = [
				usage.input_tokens,
				usage.cache_read_input_tokens ?? 0,
				usage.cache_creation_input_tokens ?? 0,
			]
			if (parts.every(valid))
				anthropicInput = parts.reduce((sum, part) => sum + part, 0)
		}
		if (row.type === 'message_delta') {
			const output = object(row.usage).output_tokens
			if (valid(output)) anthropicOutput = output
		}
		if (
			(row.type === 'message_stop' ||
				(row.type === 'message_delta' &&
					typeof object(row.delta).stop_reason === 'string')) &&
			anthropicInput !== undefined &&
			anthropicOutput !== undefined
		) {
			const total = anthropicInput + anthropicOutput
			if (valid(total) && total > 0) settle(total)
		}
	}
	const stream = response.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				pending += decoder.decode(chunk, { stream: true })
				const lines = pending.split('\n')
				pending = lines.pop() ?? ''
				for (const text of lines) line(text)
				controller.enqueue(chunk)
			},
			flush() {
				line(pending + decoder.decode())
			},
		}),
	)
	return new Response(stream, {
		status: response.status,
		headers: response.headers,
	})
}

function spendLedger(database: DatabaseSync) {
	database.exec(`CREATE TABLE IF NOT EXISTS spend_reservation (
		id INTEGER PRIMARY KEY,
		tokens INTEGER NOT NULL,
		images INTEGER NOT NULL,
		actual_tokens INTEGER,
		actual_images INTEGER,
		run_id TEXT
	) STRICT`)
	if (
		!database
			.prepare(
				"SELECT 1 FROM pragma_table_info('spend_reservation') WHERE name = 'run_id'",
			)
			.get()
	)
		database.exec('ALTER TABLE spend_reservation ADD COLUMN run_id TEXT')
}

function includeLegacyReservations(
	database: DatabaseSync,
	runId: string | null,
) {
	const csv = process.env.NL_USAGE_CSV
	if (
		!runId ||
		!database
			.prepare('SELECT 1 FROM spend_reservation WHERE run_id IS NULL LIMIT 1')
			.get()
	)
		return false
	database.exec(
		'CREATE TABLE IF NOT EXISTS spend_window (run_id TEXT PRIMARY KEY, include_legacy INTEGER NOT NULL) STRICT',
	)
	const selection = database.prepare(
		'SELECT include_legacy FROM spend_window WHERE run_id = ?',
	)
	const previous = selection.get(runId)
	if (previous) return previous.include_legacy === 1
	const includeLegacy = !csv || hasBillableUsage(csv)
	database
		.prepare('INSERT INTO spend_window VALUES (?, ?) ON CONFLICT DO NOTHING')
		.run(runId, Number(includeLegacy))
	return selection.get(runId)?.include_legacy === 1
}

function hasBillableUsage(csv: string) {
	try {
		return readFileSync(csv, 'utf8')
			.split(/\r?\n/)
			.some((line) => {
				const [tokens, images] = line.split(',').slice(3, 5)
				return Number(tokens) > 0 || Number(images) > 0
			})
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
			return false
		throw error
	}
}

function spendRunId() {
	const csv = process.env.NL_USAGE_CSV
	return (
		process.env.NL_RUN_ID ||
		(csv && createHash('sha256').update(resolve(csv)).digest('hex')) ||
		null
	)
}

const replayImageAdmissions = new Map<string, Map<string, number>>()
const inMemoryReplayAdmissions = new WeakMap<
	DatabaseSync,
	Map<string, number>
>()

function replayAdmissions(database: DatabaseSync, create = false) {
	const location = database.location()
	const existing = location
		? replayImageAdmissions.get(location)
		: inMemoryReplayAdmissions.get(database)
	if (existing || !create) return existing
	const windows = new Map<string, number>()
	if (location) replayImageAdmissions.set(location, windows)
	else inMemoryReplayAdmissions.set(database, windows)
	return windows
}

export async function noteReplayedImage(
	database: DatabaseSync,
	request: Request,
	response: Response,
) {
	const runId = spendRunId()
	if (
		!runId ||
		request.method !== 'POST' ||
		!/\/images\/(generations|edits)\/?$/.test(new URL(request.url).pathname)
	)
		return
	const actual = response.ok
		? returnedImageCount(
				await response
					.clone()
					.json()
					.catch(() => undefined),
			)
		: undefined
	const images = actual ?? (await quoteSpend(request)).images
	const windows = replayAdmissions(database, true)
	windows?.set(runId, (windows.get(runId) ?? 0) + images)
}

export function chapterImageBudget(database: DatabaseSync, workId: string) {
	const runId = spendRunId()
	if (!runId) return
	const imageCap = cap(process.env.NL_RUN_IMAGE_CAP, 'NL_RUN_IMAGE_CAP')
	spendLedger(database)
	const includeLegacy = includeLegacyReservations(database, runId)
	const { images } = database
		.prepare(
			'SELECT COALESCE(SUM(COALESCE(actual_images, images)), 0) AS images FROM spend_reservation WHERE run_id = ? OR (? AND run_id IS NULL)',
		)
		.get(runId, Number(includeLegacy)) as { images: number }
	const { chapters } = database
		.prepare(
			"SELECT COUNT(*) AS chapters FROM chapter WHERE work_id = ? AND user_state <> 'published'",
		)
		.get(workId) as { chapters: number }
	if (chapters)
		return Math.max(
			0,
			Math.floor(
				(imageCap -
					images -
					(replayAdmissions(database)?.get(runId) ?? 0) -
					5) /
					chapters,
			),
		)
}

function returnedImageCount(value: unknown) {
	const { data } = object(value)
	return Array.isArray(data)
		? data.filter((entry) => {
				const { b64_json, url } = object(entry)
				return (
					(typeof b64_json === 'string' && b64_json.length) ||
					(typeof url === 'string' && url.length)
				)
			}).length || undefined
		: undefined
}

type LiveImageSpend = { runId: string | null; done: Promise<void> }
const liveImageSpend = new Map<
	string | DatabaseSync,
	Map<number, LiveImageSpend>
>()

function trackImageSpend(
	database: DatabaseSync,
	id: number,
	runId: string | null,
) {
	const key = database.location() ?? database
	const live = liveImageSpend.get(key) ?? new Map<number, LiveImageSpend>()
	liveImageSpend.set(key, live)
	const done = Promise.withResolvers<void>()
	live.set(id, { runId, done: done.promise })
	return {
		[Symbol.dispose]() {
			live.delete(id)
			if (!live.size) liveImageSpend.delete(key)
			done.resolve()
		},
	}
}

async function waitForSettlement(live: LiveImageSpend[], signal: AbortSignal) {
	signal.throwIfAborted()
	const abort = Promise.withResolvers<never>()
	using _listener = addAbortListener(signal, () => abort.reject(signal.reason))
	await Promise.race([...live.map(({ done }) => done), abort.promise])
	signal.throwIfAborted()
}

export async function settledChapterImageBudget(
	database: DatabaseSync,
	workId: string,
	signal: AbortSignal,
) {
	const runId = spendRunId()
	if (!runId) return
	for (;;) {
		const live = Array.from(
			liveImageSpend.get(database.location() ?? database)?.values() ?? [],
		).filter((entry) => entry.runId === runId)
		if (!live.length) return chapterImageBudget(database, workId)
		await waitForSettlement(live, signal)
	}
}

export function projectSpend(database: DatabaseSync) {
	const runId = spendRunId()
	const stopFile = process.env.NL_RUN_STOP_FILE
	return async (
		request: Request,
		send: (
			request: Request,
			quote: Awaited<ReturnType<typeof quoteSpend>>,
		) => Promise<Response>,
	) => {
		const tokenCap = cap(process.env.NL_RUN_TOKEN_CAP, 'NL_RUN_TOKEN_CAP')
		const imageCap = cap(process.env.NL_RUN_IMAGE_CAP, 'NL_RUN_IMAGE_CAP')
		const softLimit = softTokenLimit(tokenCap)
		const quote = await quoteSpend(request)
		const { tokens, images } = quote
		request.signal.throwIfAborted()
		spendLedger(database)
		const includeLegacy = includeLegacyReservations(database, runId)
		const reserve = database.prepare(`
			INSERT INTO spend_reservation (tokens, images, run_id)
			SELECT ?, ?, ? FROM (
				SELECT COALESCE(SUM(COALESCE(actual_tokens, tokens)), 0) AS used_tokens,
					COALESCE(SUM(COALESCE(actual_images, images)), 0) AS used_images
				FROM spend_reservation
				WHERE (? IS NULL OR run_id = ? OR (? AND run_id IS NULL))
			)
			WHERE used_tokens + ? <= ? AND used_images + ? <= ?
			RETURNING id
		`)
		const admit = () => {
			if (stopFile && existsSync(stopFile))
				throw new SpendBudgetError('本次运行已停止接受新请求')
			return reserve.get(
				tokens,
				images,
				runId,
				runId,
				runId,
				Number(includeLegacy),
				tokens,
				softLimit,
				images,
				imageCap,
			) as { id: number } | undefined
		}
		let row = admit()
		while (!row) {
			const live = images
				? Array.from(
						liveImageSpend.get(database.location() ?? database) ?? [],
					).filter(
						([, entry]) =>
							!runId ||
							entry.runId === runId ||
							(includeLegacy && entry.runId === null),
					)
				: []
			const fitsWithoutLive =
				live.length &&
				database
					.prepare(`
					SELECT COUNT(*) FROM spend_reservation
					WHERE (? IS NULL OR run_id = ? OR (? AND run_id IS NULL))
						AND id NOT IN (SELECT value FROM json_each(?))
					HAVING COALESCE(SUM(COALESCE(actual_tokens, tokens)), 0) + ? <= ?
						AND COALESCE(SUM(COALESCE(actual_images, images)), 0) + ? <= ?
				`)
					.get(
						runId,
						runId,
						Number(includeLegacy),
						JSON.stringify(live.map(([id]) => id)),
						tokens,
						softLimit,
						images,
						imageCap,
					)
			if (!fitsWithoutLive)
				throw new SpendBudgetError(
					`超出工程预算（软停止线 ${softLimit} tokens；硬上限 ${tokenCap} tokens / ${imageCap} 张图，含未核销预留）`,
				)
			await waitForSettlement(
				live.map(([, entry]) => entry),
				request.signal,
			)
			row = admit()
		}
		const { id } = row
		using _live = images ? trackImageSpend(database, id, runId) : undefined
		const settle = (
			actualTokens: number | null,
			actualImages: number | null,
		) => {
			database
				.prepare(`
				UPDATE spend_reservation SET actual_tokens = ?, actual_images = ?
				WHERE id = ?
			`)
				.run(actualTokens, actualImages, id)
		}
		let settledTokens: number | undefined
		const settleText = (actual: number) => {
			if (settledTokens === actual) return
			settle(actual, 0)
			settledTokens = actual
		}
		let response = await send(
			new Request(request, { redirect: 'error' }),
			quote,
		)
		const type = response.headers.get('content-type') ?? ''
		if (
			definiteRejection(response.status) &&
			!type.includes('text/event-stream')
		) {
			const completedBody = await response
				.clone()
				.text()
				.catch(() => undefined)
			if (completedBody !== undefined) {
				let body: Record<string, unknown> = {}
				try {
					body = object(JSON.parse(completedBody))
				} catch {
					// A complete rejection can have an empty or plain-text body.
				}
				const actual =
					body.usage == null || object(body.usage).total_tokens === 0
						? 0
						: totalUsage(body.usage)
				if (images) settle(actual ?? null, returnedImageCount(body) ?? 0)
				else if (actual !== undefined) settleText(actual)
			}
		} else if (images && !response.ok) return response
		else if (!images && type.includes('text/event-stream'))
			response = observeUsage(response, settleText)
		else if (type.includes('json')) {
			const body = object(
				await response
					.clone()
					.json()
					.catch(() => undefined),
			)
			if (images) {
				if (Array.isArray(body.data)) {
					const tokens = totalUsage(body.usage)
					const count = returnedImageCount(body)
					settle(tokens ?? null, count ?? null)
					if (tokens !== undefined && count !== undefined)
						imageSettlements.add(response)
				}
			} else {
				const actual = totalUsage(body.usage)
				if (actual !== undefined) settleText(actual)
			}
		}
		if (!images)
			textSettlements.set(response, () => settledTokens !== undefined)
		return response
	}
}
