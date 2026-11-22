import type { ImageConfig } from '../../../packages/creator/src/models/image/index.js'

export function imageSmokeConfig(baseUrl: string, apiKey: string): ImageConfig {
	return {
		baseUrl: new URL('/v1', baseUrl).href,
		apiKey,
		model: 'gpt-image-2.6-sunburst',
		concurrency: 8,
		retries: 3,
		quality: 'high',
		nativeMaxEdge: 1536,
		postProcess: 'single',
		upscaleTier: 'anime',
	}
}
