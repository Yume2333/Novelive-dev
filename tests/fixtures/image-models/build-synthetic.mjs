import { rm } from 'node:fs/promises'
import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { createReplayFetch } from '../../../packages/creator/src/replay/index.ts'

const directory = new URL('.', import.meta.url).pathname
await rm(new URL('cassette.jsonl', import.meta.url), { force: true })
const input = await sharp(
	Buffer.from(
		'<svg width="32" height="32"><circle cx="16" cy="16" r="10" fill="blue"/></svg>',
	),
)
	.png()
	.toBuffer()
const opaque = await sharp({
	create: { width: 20, height: 20, channels: 3, background: 'blue' },
})
	.png()
	.toBuffer()
const prompts = [
	'画一个蓝色圆球，白色背景。',
	'画一个蓝色圆球，透明背景。',
	'把图中的蓝色圆球改成红色。',
]
for (const scenario of [
	'alpha',
	'opaque',
	'edit404',
	'size400',
	'unsupported',
	'moderation',
	'auth',
	'network',
	'empty',
	'bad-image',
	'url',
	'url-error',
]) {
	for (const seedream of [false, true]) {
		const model = `${seedream ? 'seedream-5.5' : 'gpt-image'}-synthetic-${scenario}`
		let capability = 0
		const client = new OpenAI({
			baseURL: 'https://relay.invalid/v1',
			apiKey: 'synthetic-key',
			maxRetries: 0,
			fetch: createReplayFetch({
				mode: 'record',
				directory,
				case: `synthetic-${scenario}`,
				tags: ['synthetic', 'not-a-provider-recording'],
				fetch: async (request) => {
					let status = 200
					let body = {
						data: [
							{
								b64_json: (scenario === 'opaque' ? opaque : input).toString(
									'base64',
								),
							},
						],
					}
					if (scenario === 'edit404' && capability !== 1) {
						status = 404
						body = { error: { message: 'Endpoint not found' } }
					}
					if (scenario === 'size400' && capability === 0) {
						status = 400
						body = { error: { message: 'Unsupported size', param: 'size' } }
					}
					if (scenario === 'unsupported') {
						status = 400
						body = {
							error: {
								code: 'InvalidParameter.UnsupportedParameter',
								message: 'Unsupported parameter',
							},
						}
					}
					if (scenario === 'moderation') {
						status = 400
						body = {
							error: {
								code: seedream
									? 'OutputImageSensitiveContentDetected'
									: 'moderation_blocked',
								message: 'Rejected',
							},
						}
					}
					if (scenario === 'auth') {
						status = 401
						body = { error: { message: 'Invalid key' } }
					}
					if (scenario === 'network') {
						status = 503
						body = {
							error: { code: 'ServerOverloaded', message: 'Retry later' },
						}
					}
					if (scenario === 'empty') body = { data: [] }
					if (scenario === 'bad-image')
						body = {
							data: [
								{ b64_json: Buffer.from('not an image').toString('base64') },
							],
						}
					if (scenario === 'url' || scenario === 'url-error') {
						if (new URL(request.url).pathname === '/synthetic.png')
							return new Response(input, {
								status: scenario === 'url-error' ? 503 : 200,
								headers: { 'content-type': 'image/png' },
							})
						body = {
							data: [
								{ url: `https://relay.invalid/synthetic.png?case=${scenario}` },
							],
						}
					}
					return new Response(JSON.stringify(body), {
						status,
						headers: { 'content-type': 'application/json' },
					})
				},
			}),
		})
		for (capability = 0; capability < 3; capability++) {
			const common = { model, prompt: prompts[capability], size: '1536x864' }
			try {
				const response = seedream
					? await client.images.generate(common, {
							body: {
								...common,
								watermark: false,
								response_format: 'b64_json',
								...(capability === 1
									? { background: 'transparent', output_format: 'png' }
									: {}),
								...(capability === 2
									? {
											image: `data:image/png;base64,${input.toString('base64')}`,
										}
									: {}),
							},
						})
					: capability === 2
						? await client.images.edit({
								...common,
								quality: 'high',
								image: await toFile(input, 'test.png', { type: 'image/png' }),
							})
						: await client.images.generate({
								...common,
								quality: 'high',
								...(capability === 1
									? { background: 'transparent', output_format: 'png' }
									: {}),
							})
				if (response.data?.[0]?.url)
					await (await client.fetch(response.data[0].url)).arrayBuffer()
			} catch (error) {
				if (!(error instanceof OpenAI.APIError)) throw error
			}
		}
	}
}
