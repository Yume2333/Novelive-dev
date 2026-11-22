import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import type { MaskedConfig } from '../../config'
import type { CommandError } from '../../contract'
import { createReplayFetch, type ReplayOptions } from '../../replay'
import { imageProvider, imageSize } from './size'

export { imageProvider, imageSize } from './size'
export type ImageConfig = Omit<
	MaskedConfig['models']['image'],
	'apiKeyMasked'
> & { apiKey: string }
export type ImageCapability = 'generate' | 'transparent' | 'edit'
export type ImageResult =
	| { ok: true; path: string; thumbnail: string }
	| { ok: false; error: CommandError }
const labels = { generate: '文生图', transparent: '透明底', edit: '图片编辑' }
export const imagePrompts = {
	generate: '画一个蓝色圆球，白色背景。',
	transparent: '画一个蓝色圆球，透明背景。',
	edit: '把图中的蓝色圆球改成红色。',
}

function unsupported(capability: ImageCapability, detail = ''): CommandError {
	return {
		code: 'unsupported',
		message: `${labels[capability]}能力不支持${detail}；请换图片模型或调低原生长边上限。`,
	}
}

export function imageError(
	error: unknown,
	capability: ImageCapability,
	signal?: AbortSignal,
): CommandError {
	if (signal?.aborted || error instanceof OpenAI.APIUserAbortError)
		return { code: 'cancelled', message: '图片测试已取消。' }
	if (error instanceof OpenAI.APIError) {
		const code = error.code ?? ''
		const detail = `${code} ${error.message}`
		if (
			/moderation|SensitiveContentDetected|RiskDetection|safety|sensitive|审核|敏感/i.test(
				detail,
			)
		)
			return {
				code: 'moderation',
				message: `${labels[capability]}被内容审核拒绝。`,
			}
		if (
			/service_unavailable|overloaded|rate.?limit/i.test(detail) ||
			error.status === 429 ||
			(error.status ?? 0) >= 500
		)
			return {
				code: 'network',
				message: '图片服务暂时不可用，请检查接口地址、Key 和模型名后重试。',
			}
		if (error.status === 401 || error.status === 403)
			return {
				code: 'auth',
				message: '图片鉴权失败，请检查接口地址、Key 和模型名。',
			}
		if (code === 'model_not_found')
			return {
				code: 'not_found',
				message: '图片模型不存在，请检查地址和模型名。',
			}
		if (
			code === 'InvalidParameter.UnsupportedParameter' ||
			(capability === 'edit' && [404, 405].includes(error.status ?? 0))
		)
			return unsupported(capability)
		if (
			error.status === 400 &&
			/size|background|quality|output_format/i.test(`${detail} ${error.param}`)
		)
			return unsupported(capability, '（尺寸或图片参数）')
		if (error.status === 404)
			return {
				code: 'not_found',
				message: '图片接口或模型不存在，请检查地址和模型名。',
			}
		if (error instanceof OpenAI.APIConnectionError)
			return {
				code: 'network',
				message: '图片连接失败，请检查接口地址、Key 和模型名。',
			}
		if (error.status === 400)
			return {
				code: 'invalid_config',
				message: '图片请求参数无效，请检查配置。',
			}
	}
	return {
		code: 'internal',
		message: `${labels[capability]}失败，图片响应无效或缓存写入失败。`,
	}
}

export async function hasTransparency(bytes: Uint8Array) {
	const image = sharp(bytes)
	if (!(await image.metadata()).hasAlpha) return false
	const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
	let transparent = 0
	for (let i = info.channels - 1; i < data.length; i += info.channels)
		if (data[i] === 0) transparent++
	return transparent / (info.width * info.height) >= 0.005
}

export async function testImage(
	config: ImageConfig,
	options: { cacheDir: string; signal?: AbortSignal; replay?: ReplayOptions },
) {
	const results = {} as Record<ImageCapability, ImageResult>
	if (!config.baseUrl || !config.apiKey || !config.model) {
		for (const capability of ['generate', 'transparent', 'edit'] as const)
			results[capability] = {
				ok: false,
				error: {
					code: 'invalid_config',
					message: '请填写图片接口地址、Key 和模型名。',
				},
			}
		return results
	}
	const fetch = createReplayFetch(options.replay)
	for (const capability of ['generate', 'transparent', 'edit'] as const) {
		try {
			options.signal?.throwIfAborted()
			const provider = imageProvider(config.baseUrl, config.model)
			const seedream = provider !== 'openai'
			const client = new OpenAI({
				baseURL: config.baseUrl,
				apiKey: config.apiKey,
				fetch,
				maxRetries: 2,
				timeout: 90000,
			})
			const { width, height } = imageSize(provider, config.nativeMaxEdge)
			const common = {
				model: config.model,
				prompt: imagePrompts[capability],
				size: `${width}x${height}` as `${number}x${number}`,
			}
			const input =
				capability === 'edit'
					? await sharp(
							Buffer.from(
								'<svg width="32" height="32"><circle cx="16" cy="16" r="10" fill="blue"/></svg>',
							),
						)
							.png()
							.toBuffer()
					: undefined
			const request = { signal: options.signal }
			const response = seedream
				? await client.images.generate(common, {
						...request,
						body: {
							...common,
							watermark: false,
							response_format: 'b64_json',
							...(capability === 'transparent'
								? { background: 'transparent', output_format: 'png' }
								: {}),
							...(input
								? { image: `data:image/png;base64,${input.toString('base64')}` }
								: {}),
						},
					})
				: input
					? await client.images.edit(
							{
								...common,
								quality: config.quality,
								image: await toFile(input, 'test.png', { type: 'image/png' }),
							},
							request,
						)
					: await client.images.generate(
							{
								...common,
								quality: config.quality,
								...(capability === 'transparent'
									? {
											background: 'transparent' as const,
											output_format: 'png' as const,
										}
									: {}),
							},
							request,
						)
			const image = response.data?.[0]
			let bytes: Buffer
			if (image?.b64_json) bytes = Buffer.from(image.b64_json, 'base64')
			else if (image?.url) {
				try {
					const deadline = AbortSignal.timeout(90000)
					const signal = options.signal
						? AbortSignal.any([options.signal, deadline])
						: deadline
					const download = await fetch(image.url, { signal })
					if (!download.ok) throw new Error('Image download failed')
					bytes = Buffer.from(await download.arrayBuffer())
				} catch (cause) {
					throw new OpenAI.APIConnectionError({
						message: 'Image download failed',
						cause: cause instanceof Error ? cause : undefined,
					})
				}
			} else throw new Error('Empty image response')
			if (
				capability === 'transparent' &&
				(!(await hasTransparency(bytes)) ||
					('background' in image && image.background !== 'transparent'))
			) {
				results[capability] = {
					ok: false,
					error: unsupported(capability, '（未返回足够的全透明像素）'),
				}
				continue
			}
			const png = await sharp(bytes).png().toBuffer()
			const thumbnail = await sharp(bytes)
				.resize({
					width: 256,
					height: 256,
					fit: 'inside',
					withoutEnlargement: true,
				})
				.webp()
				.toBuffer()
			options.signal?.throwIfAborted()
			await mkdir(options.cacheDir, { recursive: true })
			const id = randomUUID()
			const path = `${id}.png`
			const thumb = `${id}-thumb.webp`
			await writeFile(join(options.cacheDir, path), png)
			await writeFile(join(options.cacheDir, thumb), thumbnail)
			results[capability] = { ok: true, path, thumbnail: thumb }
		} catch (error) {
			results[capability] = {
				ok: false,
				error: imageError(error, capability, options.signal),
			}
		}
	}
	return results
}
