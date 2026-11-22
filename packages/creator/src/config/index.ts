import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	randomUUID,
} from 'node:crypto'
import { constants } from 'node:fs'
import {
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import {
	apiKeyMasked,
	type Config,
	type ConfigError,
	type ConfigUpdate,
	configUpdateSchema,
	type MaskedConfig,
	privateConfigSchema,
	type TextSlot,
} from './schema'

export {
	apiKeyMasked,
	type ConfigError,
	type ConfigUpdate,
	configErrorSchema,
	configUpdateSchema,
	type MaskedConfig,
	maskedConfigSchema,
	type TextSlot,
} from './schema'

const encryptionKey = Buffer.from(
	'df846708a87a482a44b97ed9fd8391e212d2995862fa4447fdbd9b9001ab99058',
	'hex',
)

const configValidator = compile(privateConfigSchema)
const updateValidator = compile(configUpdateSchema)

function defaultConfig(): Config {
	const fast: Config['models']['fast'] = {
		format: 'openai-completions',
		compat: 'auto',
		baseUrl: 'https://api.openai.com/v1',
		model: '',
		contextWindow: null,
		apiKey: '',
	}
	return {
		theme: 'system',
		language: 'zh-CN',
		projectDir: '',
		models: {
			fast,
			main: { ...fast, inheritFast: true },
			writing: { ...fast, inheritFast: true },
			visual: { ...fast, inheritFast: true },
			image: {
				baseUrl: fast.baseUrl,
				model: '',
				apiKey: '',
				concurrency: 8,
				retries: 3,
				quality: 'high',
				nativeMaxEdge: 1536,
				postProcess: 'single',
				upscaleTier: 'anime',
			},
		},
	}
}

function encrypt(apiKey: string): string {
	if (!apiKey) return ''
	const nonce = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce)
	const ciphertext = Buffer.concat([
		cipher.update(apiKey, 'utf8'),
		cipher.final(),
	])
	return `v1:${nonce.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`
}

function decrypt(sealed: string): string {
	if (!sealed) return ''
	if (!/^v1:[a-f0-9]{24}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/.test(sealed)) {
		throw new Error('Invalid encrypted API key')
	}
	const [, nonce, tag, ciphertext] = sealed.split(':')
	const decipher = createDecipheriv(
		'aes-256-gcm',
		encryptionKey,
		Buffer.from(nonce, 'hex'),
	)
	decipher.setAuthTag(Buffer.from(tag, 'hex'))
	return Buffer.concat([
		decipher.update(Buffer.from(ciphertext, 'hex')),
		decipher.final(),
	]).toString('utf8')
}

function mapKeys(config: Config, transform: (key: string) => string): Config {
	const { fast, main, writing, visual, image } = config.models
	return {
		...config,
		models: {
			fast: { ...fast, apiKey: transform(fast.apiKey) },
			main: { ...main, apiKey: transform(main.apiKey) },
			writing: { ...writing, apiKey: transform(writing.apiKey) },
			visual: { ...visual, apiKey: transform(visual.apiKey) },
			image: { ...image, apiKey: transform(image.apiKey) },
		},
	}
}

function maskModel<T extends { apiKey: string }>({ apiKey, ...rest }: T) {
	return { ...rest, apiKeyMasked: apiKey ? apiKeyMasked : '' } as const
}

function mask(config: Config): MaskedConfig {
	const {
		models: { fast, main, writing, visual, image },
		...app
	} = config
	return {
		...app,
		models: {
			fast: maskModel(fast),
			main: maskModel(main),
			writing: maskModel(writing),
			visual: maskModel(visual),
			image: maskModel(image),
		},
	}
}

function updateModel<T extends { apiKey: string }>(
	model: T,
	patch?: Partial<T>,
): T {
	const key = patch?.apiKey
	return {
		...model,
		...patch,
		apiKey: !key || key === apiKeyMasked ? model.apiKey : key,
	}
}

function isFsError(error: unknown, code: string) {
	return error instanceof Error && 'code' in error && error.code === code
}

export function createConfigStore(userData: string) {
	const path = join(userData, 'config.json')
	let writes: Promise<unknown> = Promise.resolve()

	function configError(reason: string): ConfigError {
		return { configError: { path, reason } }
	}

	async function read(): Promise<Config | ConfigError> {
		let content: string
		try {
			content = await readFile(path, 'utf8')
		} catch (error) {
			if (isFsError(error, 'ENOENT')) return defaultConfig()
			return configError('无法读取配置文件')
		}
		let input: unknown
		try {
			input = JSON.parse(content)
		} catch {
			return configError('配置文件不是有效的 JSON')
		}
		if (!configValidator.check(input)) return configError('配置字段无效')
		try {
			return mapKeys(input, decrypt)
		} catch {
			return configError('无法解密 API Key')
		}
	}

	function requireConfig(result: Config | ConfigError): Config {
		if ('configError' in result) {
			throw { code: 'invalid_config', message: result.configError.reason }
		}
		return result
	}

	async function write(config: Config) {
		const temporary = `${path}.tmp-${randomUUID()}`
		await mkdir(userData, { recursive: true })
		try {
			const json = JSON.stringify(mapKeys(config, encrypt), null, 2)
			await writeFile(temporary, `${json}\n`, {
				flag: 'wx',
				mode: 0o600,
				flush: true,
			})
			await rename(temporary, path)
		} finally {
			await rm(temporary, { force: true })
		}
	}

	function serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = writes.then(operation)
		writes = result.catch(() => {})
		return result
	}

	async function backUpBrokenConfig() {
		for (let timestamp = Date.now(); ; timestamp++) {
			try {
				await copyFile(
					path,
					`${path}.bak-${timestamp}`,
					constants.COPYFILE_EXCL,
				)
				return
			} catch (error) {
				if (!isFsError(error, 'EEXIST')) throw error
			}
		}
	}

	return {
		async get(): Promise<MaskedConfig | ConfigError> {
			const config = await read()
			return 'configError' in config ? config : mask(config)
		},
		update(patch: ConfigUpdate): Promise<MaskedConfig> {
			return serialize(async () => {
				const current = requireConfig(await read())
				if (!updateValidator.check(patch)) {
					throw { code: 'invalid_config', message: '配置更新字段无效' }
				}
				const { models, ...app } = patch
				const next = {
					...current,
					...app,
					models: {
						fast: updateModel(current.models.fast, models?.fast),
						main: updateModel(current.models.main, models?.main),
						writing: updateModel(current.models.writing, models?.writing),
						visual: updateModel(current.models.visual, models?.visual),
						image: updateModel(current.models.image, models?.image),
					},
				}
				if (!configValidator.check(next)) {
					throw { code: 'invalid_config', message: '配置更新字段无效' }
				}
				await write(next)
				return mask(next)
			})
		},
		reset(): Promise<MaskedConfig> {
			return serialize(async () => {
				if ('configError' in (await read())) await backUpBrokenConfig()
				const config = defaultConfig()
				await write(config)
				return mask(config)
			})
		},
		async resolveTextModel(slot: TextSlot): Promise<Config['models']['fast']> {
			const { models } = requireConfig(await read())
			if (slot === 'fast') return models.fast
			const { inheritFast, ...model } = models[slot]
			if (!inheritFast) return model
			return {
				...models.fast,
				model: model.model,
				contextWindow: model.contextWindow,
			}
		},
		async resolveImageModel(): Promise<Config['models']['image']> {
			return requireConfig(await read()).models.image
		},
	}
}
