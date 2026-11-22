import type {
	ConfigUpdate,
	MaskedConfig,
	TextSlot,
} from '@novelive/creator/contract'
import { useRef, useState } from 'react'
import styles from './SettingsPage.module.css'

type Models = MaskedConfig['models']
type TextModel = Models['fast'] & { inheritFast?: boolean }
type Save = (patch: ConfigUpdate) => Promise<MaskedConfig>
export type ModelDraft = {
	fields: React.ReactNode
	dirty: boolean
	save(): Promise<void>
}

export const themes = [
	['light', '亮色'],
	['dark', '暗色'],
	['system', '跟随系统'],
] as const

const formats = [
	[
		'openai-completions',
		'OpenAI Chat Completions',
		'https://api.openai.com/v1',
	],
	['openai-responses', 'OpenAI Responses', 'https://api.openai.com/v1'],
	['anthropic-messages', 'Anthropic Messages', 'https://api.anthropic.com'],
] as const
const compatibility = [
	['auto', '自动', ''],
	['openai', 'OpenAI', 'https://api.openai.com/v1'],
	['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'],
	['qwen', '通义千问', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
	['zhipu', '智谱', 'https://open.bigmodel.cn/api/paas/v4'],
	['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
	['anthropic-compat', '兼容 Anthropic', 'https://api.anthropic.com'],
] as const

export function Select<T extends string | number>({
	label,
	options,
	value,
	onChange,
	disabled,
}: {
	label: string
	options: ReadonlyArray<readonly [T, string, ...string[]]>
	value: T
	onChange(value: T): void
	disabled?: boolean
}) {
	return (
		<select
			aria-label={label}
			value={value}
			disabled={disabled}
			onChange={(event) => {
				const option = options.find(
					([key]) => String(key) === event.target.value,
				)
				if (option) onChange(option[0])
			}}
		>
			{options.map(([key, name]) => (
				<option key={key} value={key}>
					{name}
				</option>
			))}
		</select>
	)
}

function Input({
	label,
	...props
}: React.ComponentProps<'input'> & { label: string }) {
	return (
		<label className={styles.field}>
			<span>{label}</span>
			<input {...props} />
		</label>
	)
}

function ApiKeyInput({
	value,
	disabled,
	onChange,
}: {
	value: string
	disabled?: boolean
	onChange(value: string): void
}) {
	const [focused, setFocused] = useState(false)
	return (
		<Input
			label="API Key"
			type="password"
			autoComplete="new-password"
			value={focused && value === '••••' ? '' : value}
			disabled={disabled}
			placeholder="sk-…"
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			onChange={(event) => onChange(event.target.value)}
		/>
	)
}

function integer(text: string, minimum: number) {
	const number = Number(text)
	if (!text.trim() || !Number.isSafeInteger(number) || number < minimum)
		throw {
			code: 'invalid_config',
			message: `请输入不小于 ${minimum} 的整数。`,
		}
	return number
}

function textDraft(model: TextModel) {
	const { apiKeyMasked, contextWindow, ...rest } = model
	return {
		...rest,
		apiKey: apiKeyMasked as string,
		context: contextWindow?.toString() ?? '',
	}
}

export function useTextFields(
	slot: TextSlot,
	saved: TextModel,
	fast: Models['fast'],
	update: Save,
): ModelDraft {
	const [draft, setDraft] = useState(() => textDraft(saved))
	const revision = useRef(0)
	const lastModel = useRef(saved.model)
	const inherited = slot !== 'fast' && draft.inheritFast
	const connection = inherited ? fast : draft
	const change = (patch: Partial<typeof draft>) => {
		revision.current++
		setDraft((previous) => ({ ...previous, ...patch }))
	}
	function suggest(next: typeof draft, useFast = inherited) {
		const current = ++revision.current
		if (!next.model.trim()) return
		const { format, compat } = useFast ? fast : next
		void window.novelive
			.call('model.suggestContextWindow', {
				model: next.model.trim(),
				format,
				compat,
			})
			.promise.then(
				(value) => {
					if (value !== null && current === revision.current)
						setDraft((previous) => ({ ...previous, context: String(value) }))
				},
				() => {},
			)
	}
	return {
		dirty: JSON.stringify(draft) !== JSON.stringify(textDraft(saved)),
		async save() {
			revision.current++
			const { context, ...model } = draft
			const result = await update({
				models: {
					[slot]: {
						...model,
						baseUrl: model.baseUrl.trim(),
						model: model.model.trim(),
						contextWindow: context.trim() ? integer(context, 4096) : null,
					},
				},
			})
			lastModel.current = result.models[slot].model
			setDraft(textDraft(result.models[slot]))
		},
		fields: (
			<>
				<div className={styles.field}>
					<span>兼容哪家</span>
					<Select
						label="兼容哪家"
						options={compatibility}
						value={connection.compat}
						disabled={inherited}
						onChange={(compat) => {
							const baseUrl =
								compatibility.find(([name]) => name === compat)?.[2] ||
								draft.baseUrl
							change({ compat, baseUrl })
							suggest({ ...draft, compat, baseUrl })
						}}
					/>
				</div>
				<div className={styles.field}>
					<span>接口格式</span>
					<Select
						label="接口格式"
						options={formats}
						value={connection.format}
						disabled={inherited}
						onChange={(format) => {
							const baseUrl =
								formats.find(([name]) => name === format)?.[2] ?? draft.baseUrl
							change({ format, baseUrl })
							suggest({ ...draft, format, baseUrl })
						}}
					/>
				</div>
				{slot !== 'fast' && (
					<label className={styles.inherit}>
						<input
							type="checkbox"
							checked={Boolean(inherited)}
							onChange={(event) => {
								const inheritFast = event.target.checked
								const nextConnection = inheritFast ? fast : draft
								change({ inheritFast })
								if (
									nextConnection.format !== connection.format ||
									nextConnection.compat !== connection.compat
								)
									suggest({ ...draft, inheritFast }, inheritFast)
							}}
						/>{' '}
						同快速模型
					</label>
				)}
				<Input
					label="接口地址"
					value={connection.baseUrl}
					placeholder="https://…"
					disabled={inherited}
					onChange={(event) => change({ baseUrl: event.target.value })}
				/>
				<Input
					label="模型名"
					value={draft.model}
					placeholder="模型名"
					onChange={(event) =>
						change({ model: event.target.value, context: '' })
					}
					onBlur={() => {
						if (lastModel.current !== draft.model) {
							lastModel.current = draft.model
							suggest(draft)
						}
					}}
				/>
				<Input
					label="上下文长度"
					value={draft.context}
					inputMode="numeric"
					placeholder="模型上下文窗口 tokens（至少 4096）"
					onChange={(event) => change({ context: event.target.value })}
				/>
				<ApiKeyInput
					value={inherited ? fast.apiKeyMasked : draft.apiKey}
					disabled={inherited}
					onChange={(apiKey) => change({ apiKey })}
				/>
			</>
		),
	}
}

function imageDraft(model: Models['image']) {
	const { apiKeyMasked, concurrency, retries, ...rest } = model
	return {
		...rest,
		apiKey: apiKeyMasked as string,
		concurrency: String(concurrency),
		retries: String(retries),
	}
}

export function useImageFields(
	saved: Models['image'],
	update: Save,
): ModelDraft {
	const [draft, setDraft] = useState(() => imageDraft(saved))
	const change = (patch: Partial<typeof draft>) =>
		setDraft((previous) => ({ ...previous, ...patch }))
	return {
		dirty: JSON.stringify(draft) !== JSON.stringify(imageDraft(saved)),
		async save() {
			const result = await update({
				models: {
					image: {
						...draft,
						baseUrl: draft.baseUrl.trim(),
						model: draft.model.trim(),
						concurrency: integer(draft.concurrency, 1),
						retries: integer(draft.retries, 0),
					},
				},
			})
			setDraft(imageDraft(result.models.image))
		},
		fields: (
			<>
				<Input
					label="接口地址"
					value={draft.baseUrl}
					placeholder="https://…"
					onChange={(event) => change({ baseUrl: event.target.value })}
				/>
				<Input
					label="模型名"
					value={draft.model}
					placeholder="模型名"
					onChange={(event) => change({ model: event.target.value })}
				/>
				<div className={styles.fullField}>
					<ApiKeyInput
						value={draft.apiKey}
						onChange={(apiKey) => change({ apiKey })}
					/>
				</div>
				<div className={styles.field}>
					<span>生图质量</span>
					<Select
						label="生图质量"
						value={draft.quality}
						options={[
							['high', '高'],
							['medium', '中'],
							['low', '低'],
						]}
						onChange={(quality) => change({ quality })}
					/>
				</div>
				<div className={styles.field}>
					<span>原生长边上限</span>
					<Select
						label="原生长边上限"
						value={draft.nativeMaxEdge}
						options={[
							[1536, '1536（Codex 渠道）'],
							[2048, '2048'],
							[2560, '2560（OpenAI 官方 API）'],
							[2816, '2816（Seedream 5.x）'],
							[3840, '3840 · 4K（OpenAI 实验 / Seedream 4.5）'],
						]}
						onChange={(nativeMaxEdge) => change({ nativeMaxEdge })}
					/>
				</div>
				<Input
					label="同时出图数"
					inputMode="numeric"
					value={draft.concurrency}
					onChange={(event) => change({ concurrency: event.target.value })}
				/>
				<Input
					label="生图失败重试次数"
					inputMode="numeric"
					value={draft.retries}
					onChange={(event) => change({ retries: event.target.value })}
				/>
				<div className={styles.postProcess}>
					<div className={styles.field}>
						<span>后处理</span>
						<Select
							label="后处理"
							value={draft.postProcess}
							options={[
								['off', '关'],
								['single', '放大降噪'],
								['double', '双重放大降噪'],
							]}
							onChange={(postProcess) => change({ postProcess })}
						/>
					</div>
					<div className={styles.field}>
						<span>放大档位</span>
						<Select
							label="放大档位"
							value={draft.upscaleTier}
							disabled={draft.postProcess === 'off'}
							options={[
								['anime', '动漫'],
								['fast', '快速（低性能机用，画质下降）'],
								['detail', '保留细节（少改原画，保留纹理细节）'],
							]}
							onChange={(upscaleTier) => change({ upscaleTier })}
						/>
					</div>
				</div>
			</>
		),
	}
}
