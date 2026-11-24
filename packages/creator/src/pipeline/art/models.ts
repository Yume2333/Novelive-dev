import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { compile, type Schema } from '@earendil-works/pi-schema'
import OpenAI, { toFile } from 'openai'
import type { CommandError } from '../../contract'
import {
	type ImageCapability,
	type ImageConfig,
	imageError,
	imageProvider,
} from '../../models/image'
import { imageDownloadUpstream } from '../../models/image/download'
import {
	buildTextModel,
	createTextStream,
	parseModelJson,
	type TextConnection,
	textResultError,
} from '../../models/text'
import {
	createReplayFetch,
	inheritSpendGuard,
	isSpendGuardedFetch,
	type ReplayOptions,
} from '../../replay'
import { recordImageUsage } from '../../usage'
import { SpendBudgetError } from '../../usage/spend'
import type { Dimensions } from './check'

export type ModelOptions = { signal?: AbortSignal; replay?: ReplayOptions }
type JsonOptions = ModelOptions & {
	maxTokens?: number
	onUsableReply?: (save: () => Promise<void>) => void
}

export class ArtResponseFormatError extends Error {
	constructor(
		message: string,
		readonly rejected: unknown,
	) {
		super(message)
	}
}

export class ArtResponseSchemaError extends ArtResponseFormatError {}

export async function artJson<T>(
	connection: TextConnection,
	prompt: string,
	schema: Schema<T>,
	options: JsonOptions,
	images: readonly Buffer[] = [],
	formatRepair: 'once' | 'caller' = 'once',
): Promise<T> {
	const request = (suffix: string) =>
		requestArtJson(connection, prompt + suffix, schema, options, images)
	try {
		return await request('')
	} catch (error) {
		if (formatRepair === 'caller' || !(error instanceof ArtResponseFormatError))
			throw error
		return request(
			`\nThe previous reply was invalid: ${error.message}. Return only corrected JSON matching the requested format.`,
		)
	}
}

function checkedReplay(fetch: typeof globalThis.fetch) {
	let failure: unknown
	return {
		get failure() {
			return failure
		},
		fetch: inheritSpendGuard(fetch, async (input, init) => {
			try {
				return await fetch(input, init)
			} catch (error) {
				if (
					error instanceof SpendBudgetError ||
					(error instanceof Error &&
						error.message.startsWith('Missing strict replay cassette:'))
				)
					failure = error
				throw error
			}
		}),
	}
}

export function imageRenderer(
	config: ImageConfig,
	options: ModelOptions,
	generationReplay = options.replay,
) {
	const provider = imageProvider(config.baseUrl, config.model)
	const replay = checkedReplay(createReplayFetch(generationReplay))
	const metered = isSpendGuardedFetch(replay.fetch)
	const download = createReplayFetch({
		...generationReplay,
		fetch: imageDownloadUpstream(config.baseUrl, generationReplay?.fetch),
		spend: undefined,
	})
	const client = new OpenAI({
		baseURL: config.baseUrl,
		apiKey: config.apiKey,
		fetch: Object.assign(replay.fetch, { Response }),
		timeout: 90_000,
		maxRetries: 0,
	})
	return async (
		prompt: string,
		refs: readonly Buffer[],
		size: Dimensions,
		transparent: boolean,
	): Promise<
		| { bytes: Buffer }
		| { error: CommandError; referenceModerated?: true; doNotRegenerate?: true }
	> => {
		const capability: ImageCapability = refs.length
			? 'edit'
			: transparent
				? 'transparent'
				: 'generate'
		const parameters = {
			model: config.model,
			prompt,
			size: `${size.width}x${size.height}` as const,
		}
		const signal = options.signal
		const output = transparent
			? ({ background: 'transparent', output_format: 'png' } as const)
			: {}
		const seedream = provider !== 'openai'
		let generationSucceeded = false
		try {
			signal?.throwIfAborted()
			const generation = seedream
				? client.images.generate(parameters, {
						signal,
						body: {
							...parameters,
							...output,
							watermark: false,
							response_format: 'b64_json',
							...(refs.length
								? {
										image: refs.map(
											(ref) =>
												`data:image/png;base64,${ref.toString('base64')}`,
										),
									}
								: {}),
						},
					})
				: refs.length
					? client.images.edit(
							{
								...parameters,
								...output,
								n: 1,
								quality: config.quality,
								image: await Promise.all(
									refs.map((ref, index) =>
										toFile(ref, `ref-${index + 1}.png`, { type: 'image/png' }),
									),
								),
							},
							{ signal },
						)
					: client.images.generate(
							{ ...parameters, ...output, n: 1, quality: config.quality },
							{ signal },
						)
			generationSucceeded = (await generation.asResponse()).ok
			const response = await generation
			recordImageUsage(
				config.model,
				response.data?.filter((image) => image.b64_json || image.url).length ??
					0,
			)
			const image = response.data?.[0] as
				| {
						b64_json?: string
						url?: string
						error?: { code: string; message: string }
				  }
				| undefined
			if (seedream && image?.error && !image.b64_json && !image.url) {
				generationSucceeded = false
				throw new OpenAI.APIError(
					400,
					image.error,
					image.error.message,
					new Headers(),
				)
			}
			if (image?.b64_json)
				return { bytes: Buffer.from(image.b64_json, 'base64') }
			if (image?.url) {
				const deadline = AbortSignal.timeout(90_000)
				const downloadSignal = signal
					? AbortSignal.any([signal, deadline])
					: deadline
				for (let attempt = 0; attempt < (metered ? 2 : 1); attempt++) {
					try {
						const response = await download(new URL(image.url), {
							signal: downloadSignal,
						})
						if (response.ok)
							return { bytes: Buffer.from(await response.arrayBuffer()) }
						await response.body?.cancel()
						if (response.status < 500 && response.status !== 429) break
					} catch (error) {
						downloadSignal.throwIfAborted()
						if (!metered || attempt > 0) throw error
					}
				}
				throw new OpenAI.APIConnectionError({
					message: 'Image download failed',
				})
			}
			throw new Error('Empty image response')
		} catch (error) {
			if (replay.failure) throw replay.failure
			if (
				error instanceof Error &&
				error.message.startsWith('Missing strict replay cassette:')
			)
				throw error
			const failure = imageError(error, capability, signal)
			const status = error instanceof OpenAI.APIError ? error.status : undefined
			const doNotRegenerate =
				metered &&
				(generationSucceeded ||
					error instanceof OpenAI.APIConnectionError ||
					status === 408 ||
					status === 409 ||
					(status ?? 0) >= 500)
			const referenceModerated =
				failure.code === 'moderation' &&
				error instanceof OpenAI.APIError &&
				/^InputImage(?:SensitiveContentDetected|RiskDetection)(?:\.|$)/i.test(
					error.code ?? '',
				)
			return {
				error: failure,
				...(doNotRegenerate && { doNotRegenerate: true }),
				...(referenceModerated && { referenceModerated: true }),
			}
		}
	}
}

async function requestArtJson<T>(
	connection: TextConnection,
	prompt: string,
	schema: Schema<T>,
	options: JsonOptions,
	images: readonly Buffer[],
): Promise<T> {
	const model = buildTextModel(connection, images.length > 0)
	let saveReply: (() => Promise<void>) | undefined
	const replay = checkedReplay(
		createReplayFetch({
			...options.replay,
			onCheckpointReply: (save) => {
				saveReply = save
			},
		}),
	)
	const content = [
		{ type: 'text' as const, text: prompt },
		...images.map((png) => ({
			type: 'image' as const,
			mimeType: 'image/png',
			data: png.toString('base64'),
		})),
	]
	const response = await createTextStream({
		fetch: replay.fetch,
		stopOnUnknownOutcome: true,
	})(
		model,
		normalizeContext({
			messages: [{ role: 'user', content, timestamp: 0 }],
		}),
		{
			apiKey: connection.apiKey,
			signal: options.signal,
			cacheRetention: 'none',
			...(options.maxTokens === undefined
				? {}
				: { maxTokens: options.maxTokens, outputLimit: options.maxTokens }),
		},
	).result()
	options.signal?.throwIfAborted()
	if (replay.failure) throw replay.failure
	if (response.stopReason !== 'stop')
		throw textResultError(response, `Art model stopped: ${response.stopReason}`)
	const text = response.content
		.flatMap((part) => (part.type === 'text' ? [part.text] : []))
		.join('')
	if (text.trim() && saveReply) options.onUsableReply?.(saveReply)
	let value: unknown
	try {
		value = parseModelJson(text)
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		throw new ArtResponseFormatError(
			'Art model returned invalid JSON',
			undefined,
		)
	}
	const validated = compile(schema).validate(value)
	if (!validated.ok)
		throw new ArtResponseSchemaError(JSON.stringify(validated.errors), value)
	return validated.value
}
