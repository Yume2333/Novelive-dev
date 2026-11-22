import type { ImageContent } from '@earendil-works/pi-ai'
import type { TextConnection } from '../../../packages/creator/src/models/text/index.js'

const pixel: ImageContent = {
	type: 'image',
	mimeType: 'image/png',
	data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
}

export const smokeProfiles = [
	{
		format: 'openai-completions',
		model: 'gemini-3.8-flash',
		basePath: '/v1',
		contextWindow: 1_000_000,
		image: pixel,
	},
	{
		format: 'openai-responses',
		model: 'devin-swe-2',
		basePath: '/v1',
		contextWindow: 256_000,
	},
	{
		format: 'anthropic-messages',
		model: 'deepseek-v4.1-flash',
		basePath: '/',
		contextWindow: 1_000_000,
	},
] satisfies (Pick<TextConnection, 'format' | 'model' | 'contextWindow'> & {
	basePath: string
	image?: ImageContent
})[]

export function smokeConnection(
	profile: (typeof smokeProfiles)[number],
	baseUrl: string,
	apiKey: string,
): TextConnection {
	return {
		format: profile.format,
		model: profile.model,
		contextWindow: profile.contextWindow,
		baseUrl: new URL(profile.basePath, baseUrl).href,
		compat: 'auto',
		apiKey,
	}
}
