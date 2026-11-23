import {
	arr,
	bool,
	int,
	lit,
	nullable,
	num,
	Optional,
	obj,
	oneOf,
	opt,
	type Schema,
	type Static,
	str,
} from '@earendil-works/pi-schema'
import { entityId } from '@novelive/format/model'

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
	maxOutputTokens: opt(
		nullable(int({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
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

const textSlots = ['fast', 'main', 'writing', 'visual'] as const
export const roleModelDefaults = {
	organizer: 'fast',
	director: 'main',
	writer: 'writing',
	'reviewer-script': 'main',
	artist: 'main',
	'painter-portrait': 'main',
	'painter-scene': 'main',
	'painter-variant': 'fast',
	'reviewer-visual': 'visual',
} as const satisfies Record<string, (typeof textSlots)[number]>
export type ProductionRole = keyof typeof roleModelDefaults

const roleModels = obj({
	organizer: opt(oneOf(textSlots)),
	director: opt(oneOf(textSlots)),
	writer: opt(oneOf(textSlots)),
	'reviewer-script': opt(oneOf(textSlots)),
	artist: opt(oneOf(textSlots)),
	'painter-portrait': opt(oneOf(textSlots)),
	'painter-scene': opt(oneOf(textSlots)),
	'painter-variant': opt(oneOf(textSlots)),
	'reviewer-visual': opt(oneOf(textSlots)),
})
const writerPreset = obj({
	id: entityId,
	name: str({ minLength: 1 }),
	style: str(),
	constraints: str(),
	temperature: opt(num({ minimum: 0, maximum: 2 })),
	topP: opt(num({ minimum: 0, maximum: 1 })),
	maxTokens: opt(int({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
	replacements: arr(obj({ find: str({ minLength: 1 }), replace: str() })),
})
const writerSettings = obj({
	defaultPresetId: entityId,
	presets: arr(writerPreset, { minItems: 1 }),
})
const productionFields = { roleModels, writer: writerSettings }
const productionSettings = obj(productionFields)

export type WriterPreset = Static<typeof writerPreset>
export type WriterSettings = Static<typeof writerSettings>
export type ProductionSettings = Static<typeof productionSettings>

function modelFields<K extends Record<string, Schema>>(key: K) {
	const fast = { ...textFields, ...key }
	const inherited = { ...fast, inheritFast: bool() }
	return { fast, inherited, image: { ...imageFields, ...key } }
}

function configFields<K extends Record<string, Schema>>(key: K) {
	const { fast, inherited, image } = modelFields(key)
	return {
		...appFields,
		models: obj({
			fast: obj(fast),
			main: obj(inherited),
			writing: obj(inherited),
			visual: obj(inherited),
			image: obj(image),
		}),
	}
}

const privateFields = { apiKey: str() }
export const privateConfigSchema = obj({
	...configFields(privateFields),
	production: opt(productionSettings),
})
const configErrorSchema = obj({
	configError: obj({ path: str(), reason: str() }),
})

function optionalFields<T extends Record<string, Schema | Optional>>(
	fields: T,
) {
	return Object.fromEntries(
		Object.entries(fields).map(([key, schema]) => [
			key,
			schema instanceof Optional ? schema : opt(schema),
		]),
	) as {
		[K in keyof T]: T[K] extends Schema ? Optional<T[K]> : T[K]
	}
}

const fields = modelFields(privateFields)
const inheritedPatch = obj(optionalFields(fields.inherited))
export const configUpdateSchema = obj({
	...optionalFields(appFields),
	production: opt(obj(optionalFields(productionFields))),
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

export { configErrorSchema }
export const maskedConfigSchema = obj({
	...configFields({ apiKeyMasked: oneOf(['', apiKeyMasked]) }),
	production: productionSettings,
})
export type ConfigUpdate = Static<typeof configUpdateSchema>
export type MaskedConfig = Static<typeof maskedConfigSchema>
export type ConfigError = Static<typeof configErrorSchema>
export type Config = Static<typeof privateConfigSchema>
export type TextSlot = Exclude<keyof Config['models'], 'image'>
