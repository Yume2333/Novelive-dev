import type { DatabaseSync } from 'node:sqlite'
import { reserveTokenFields } from './reservation'

export class SpendBudgetError extends Error {
	readonly code = 'invalid_config'

	constructor(detail: string) {
		super(`已停止模型请求：${detail}`)
	}
}

const valid = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

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

export async function quoteSpend(request: Request) {
	const path = new URL(request.url).pathname.replace(/\/$/, '')
	try {
		if (request.method !== 'POST') throw new Error()
		if (/\/images\/(?:generations|edits)$/.test(path)) {
			const n = request.headers.get('content-type')?.startsWith('multipart/')
				? ((await request.clone().formData()).get('n') ?? '1')
				: (object(await request.clone().json()).n ?? 1)
			const count = typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n
			if (!valid(count) || count < 1) throw new Error()
			const perImage = cap(
				process.env.NL_RUN_IMAGE_TOKEN_RESERVE ?? '100000',
				'NL_RUN_IMAGE_TOKEN_RESERVE',
			)
			const tokens = count * perImage
			if (!perImage || !valid(tokens)) throw new Error()
			return { tokens, images: count }
		}
		const responses = path.endsWith('/responses')
		if (!responses && !/\/(?:chat\/completions|messages)$/.test(path))
			throw new Error()
		const body = object(await request.clone().json())
		const output = requestedOutputTokens(request, body)
		const input = responses ? body.input : body.messages
		if (
			!valid(output) ||
			output < 1 ||
			(!Array.isArray(input) && !(responses && typeof input === 'string'))
		)
			throw new Error()
		const fields: string[] = []
		let largeFieldBytes = 0
		function collect(value: unknown) {
			if (typeof value === 'string' && value.length > 16_384) {
				largeFieldBytes += Buffer.byteLength(value)
			} else if (Array.isArray(value)) {
				for (const item of value) collect(item)
			} else if (value && typeof value === 'object') {
				for (const [key, item] of Object.entries(value)) {
					fields.push(key)
					collect(item)
				}
			} else {
				fields.push(String(value))
			}
		}
		collect(body)
		const tokens = reserveTokenFields(fields, output).reserved + largeFieldBytes
		if (!valid(tokens)) throw new Error()
		return { tokens, images: 0 }
	} catch (error) {
		if (error instanceof SpendBudgetError) throw error
		throw new SpendBudgetError('无法核算此模型请求的预算')
	}
}

function observeUsage(response: Response, settle: (tokens: number) => void) {
	if (!response.body) return response
	let pending = ''
	let tokens: number | undefined
	let anthropicInput: number | undefined
	let anthropicOutput: number | undefined
	const decoder = new TextDecoder()
	function line(text: string) {
		if (!text.startsWith('data:')) return
		const data = text.slice(5).trim()
		if (data === '[DONE]') {
			if (tokens !== undefined) settle(tokens)
			return
		}
		let row: Record<string, unknown>
		try {
			row = object(JSON.parse(data))
		} catch {
			return
		}
		tokens = totalUsage(row.usage) ?? tokens
		if (
			row.type === 'response.completed' ||
			row.type === 'response.incomplete'
		) {
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
			row.type === 'message_stop' &&
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

export function projectSpend(database: DatabaseSync) {
	return async (
		request: Request,
		send: (
			request: Request,
			quote: Awaited<ReturnType<typeof quoteSpend>>,
		) => Promise<Response>,
	) => {
		const tokenCap = cap(process.env.NL_RUN_TOKEN_CAP, 'NL_RUN_TOKEN_CAP')
		const imageCap = cap(process.env.NL_RUN_IMAGE_CAP, 'NL_RUN_IMAGE_CAP')
		const quote = await quoteSpend(request)
		const { tokens, images } = quote
		request.signal.throwIfAborted()
		database.exec(`CREATE TABLE IF NOT EXISTS spend_reservation (
			id INTEGER PRIMARY KEY,
			tokens INTEGER NOT NULL,
			images INTEGER NOT NULL,
			actual_tokens INTEGER,
			actual_images INTEGER
		) STRICT`)
		const row = database
			.prepare(`
			INSERT INTO spend_reservation (tokens, images)
			SELECT ?, ? FROM (
				SELECT COALESCE(SUM(COALESCE(actual_tokens, tokens)), 0) AS used_tokens,
					COALESCE(SUM(COALESCE(actual_images, images)), 0) AS used_images
				FROM spend_reservation
			)
			WHERE used_tokens + ? <= ? AND used_images + ? <= ?
			RETURNING id
		`)
			.get(tokens, images, tokens, tokenCap, images, imageCap) as
			| { id: number }
			| undefined
		if (!row)
			throw new SpendBudgetError(
				`超出工程预算（上限 ${tokenCap} tokens / ${imageCap} 张图，含未核销预留）`,
			)
		const settle = (
			actualTokens: number | null,
			actualImages: number | null,
		) => {
			database
				.prepare(`
				UPDATE spend_reservation SET actual_tokens = ?, actual_images = ?
				WHERE id = ?
			`)
				.run(actualTokens, actualImages, row.id)
		}
		const response = await send(
			new Request(request, { redirect: 'error' }),
			quote,
		)
		if (!response.ok) return response
		const type = response.headers.get('content-type') ?? ''
		if (!images && type.includes('text/event-stream'))
			return observeUsage(response, (actual) => settle(actual, 0))
		if (type.includes('json')) {
			const body = object(
				await response
					.clone()
					.json()
					.catch(() => undefined),
			)
			if (images) {
				if (Array.isArray(body.data)) {
					const count = body.data.filter((entry) => {
						const { b64_json, url } = object(entry)
						return (
							(typeof b64_json === 'string' && b64_json.length) ||
							(typeof url === 'string' && url.length)
						)
					}).length
					settle(totalUsage(body.usage) ?? null, count || null)
				}
			} else {
				const actual = totalUsage(body.usage)
				if (actual !== undefined) settle(actual, 0)
			}
		}
		return response
	}
}
