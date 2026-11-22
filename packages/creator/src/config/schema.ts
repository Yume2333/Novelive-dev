import {
	bool,
	int,
	lit,
	nullable,
	type Optional,
	obj,
	oneOf,
	opt,
	type Schema,
	type Static,
	str,
} from '@earendil-works/pi-schema'

export const apiKeyMasked = '••••'

const connection = {
	baseUrl: str(),
	model: str(),
}
const textFields = {
	...connection,
	format: oneOf([
		'openai-completions',
		'openai-responses',
		'anthropic-messages',
	]),
	compat: oneOf([
		'auto',
		'openai',
		'deepseek',
		'qwen',
		'zhipu',
		'openrouter',
		'anthropic-compat',
	]),
	contextWindow: nullable(
		int({ minimum: 4096, maximum: Number.MAX_SAFE_INTEGER }),
	),
}
export const textCatalogSchema = obj({
	model: textFields.model,
	format: textFields.format,
	compat: textFields.compat,
})
const imageFields = {
	...connection,
	concurrency: int({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
	retries: int({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	quality: oneOf(['high', 'medium', 'low']),
	nativeMaxEdge: oneOf([1536, 2048, 2560, 2816, 3840]),
	postProcess: oneOf(['off', 'single', 'double']),
	upscaleTier: oneOf(['anime', 'fast', 'detail']),
}
const appFields = {
	theme: oneOf(['light', 'dark', 'system']),
	language: lit('zh-CN'),
	projectDir: str(),
}

function modelFields<K extends Record<string, Schema>>(key: K) {
	const fast = { ...textFields, ...key }
	const inherited = { ...fast, inheritFast: bool() }
	return { fast, inherited, image: { ...imageFields, ...key } }
}

function configSchema<K extends Record<string, Schema>>(key: K) {
	const { fast, inherited, image } = modelFields(key)
	return obj({
		...appFields,
		models: obj({
			fast: obj(fast),
			main: obj(inherited),
			writing: obj(inherited),
			visual: obj(inherited),
			image: obj(image),
		}),
	})
}

const privateFields = { apiKey: str() }
export const privateConfigSchema = configSchema(privateFields)
const maskedSchema = configSchema({ apiKeyMasked: oneOf(['', apiKeyMasked]) })
const configErrorSchema = obj({
	configError: obj({ path: str(), reason: str() }),
})

function optionalFields<T extends Record<string, Schema>>(fields: T) {
	return Object.fromEntries(
		Object.entries(fields).map(([key, schema]) => [key, opt(schema)]),
	) as {
		[K in keyof T]: Optional<T[K]>
	}
}

const fields = modelFields(privateFields)
const inheritedPatch = obj(optionalFields(fields.inherited))
export const configUpdateSchema = obj({
	...optionalFields(appFields),
	models: opt(
		obj({
			fast: opt(obj(optionalFields(fields.fast))),
			main: opt(inheritedPatch),
			writing: opt(inheritedPatch),
			visual: opt(inheritedPatch),
			image: opt(obj(optionalFields(fields.image))),
		}),
	),
})

export { configErrorSchema, maskedSchema as maskedConfigSchema }
export type ConfigUpdate = Static<typeof configUpdateSchema>
export type MaskedConfig = Static<typeof maskedSchema>
export type ConfigError = Static<typeof configErrorSchema>
export type Config = Static<typeof privateConfigSchema>
export type TextSlot = Exclude<keyof Config['models'], 'image'>
