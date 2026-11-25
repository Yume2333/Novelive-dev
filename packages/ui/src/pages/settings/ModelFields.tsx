import type {
	ConfigUpdate,
	MaskedConfig,
	TextSlot,
} from '@novelive/creator/contract'
import { useRef, useState } from 'react'
import { Checkbox } from '../../components/Extended'
import { CompactSelect, Field, TextInput } from '../../components/Form'
import { InfoTooltip } from '../../components/InfoTooltip'
import { msg, scoped } from '../../i18n'
import styles from './SettingsPage.module.css'

const t = scoped('settings')

type Models = MaskedConfig['models']
type TextModel = Models['fast'] & { inheritFast?: boolean }
type Save = (patch: ConfigUpdate) => Promise<MaskedConfig>
export type ModelDraft = {
	fields: React.ReactNode
	dirty: boolean
	save(): Promise<void>
}

export const themes = [
	['light', msg('亮')],
	['dark', msg('暗')],
	['system', msg('跟随系统')],
] as const

export const formatLabel = (format: string) =>
	formats.find(([name]) => name === format)?.[1] ?? format

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
	['auto', msg('自动'), ''],
	['openai', 'OpenAI', 'https://api.openai.com/v1'],
	['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'],
	[
		'qwen',
		msg('通义千问'),
		'https://dashscope.aliyuncs.com/compatible-mode/v1',
	],
	['zhipu', msg('智谱'), 'https://open.bigmodel.cn/api/paas/v4'],
	['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
	['anthropic-compat', msg('兼容 Anthropic'), 'https://api.anthropic.com'],
] as const

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
		<Field label="API Key">
			<TextInput
				type="password"
				autoComplete="new-password"
				value={focused && value === '••••' ? '' : value}
				disabled={disabled}
				placeholder="sk-…"
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onChange={onChange}
			/>
		</Field>
	)
}

function integer(text: string, minimum: number) {
	const number = Number(text)
	if (!text.trim() || !Number.isSafeInteger(number) || number < minimum)
		throw {
			code: 'invalid_config',
			localized: true,
			message: t('请输入不小于 {{minimum}} 的整数。', { minimum }),
		}
	return number
}

function textDraft(model: TextModel) {
	const { apiKeyMasked, contextWindow, maxOutputTokens, ...rest } = model
	return {
		...rest,
		apiKey: apiKeyMasked as string,
		context: contextWindow?.toString() ?? '',
		output: maxOutputTokens?.toString() ?? '',
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
			const { context, output, ...model } = draft
			const result = await update({
				models: {
					[slot]: {
						...model,
						baseUrl: model.baseUrl.trim(),
						model: model.model.trim(),
						contextWindow: context.trim() ? integer(context, 4096) : null,
						maxOutputTokens: output.trim() ? integer(output, 1) : null,
					},
				},
			})
			lastModel.current = result.models[slot].model
			setDraft(textDraft(result.models[slot]))
		},
		fields: (
			<>
				<Field label={t('兼容哪家')}>
					<CompactSelect
						aria-label={t('兼容哪家')}
						options={compatibility.map(([value, name]) => ({
							value,
							label: t(name),
						}))}
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
				</Field>
				<Field label={t('接口格式')}>
					<CompactSelect
						aria-label={t('接口格式')}
						options={formats.map(([value, name]) => ({ value, label: name }))}
						value={connection.format}
						disabled={inherited}
						onChange={(format) => {
							const baseUrl =
								formats.find(([name]) => name === format)?.[2] ?? draft.baseUrl
							change({ format, baseUrl })
							suggest({ ...draft, format, baseUrl })
						}}
					/>
				</Field>
				{slot !== 'fast' && (
					<div className={styles.inherit}>
						<Checkbox
							checked={Boolean(inherited)}
							onChange={(inheritFast) => {
								const nextConnection = inheritFast ? fast : draft
								change({ inheritFast })
								if (
									nextConnection.format !== connection.format ||
									nextConnection.compat !== connection.compat
								)
									suggest({ ...draft, inheritFast }, inheritFast)
							}}
							label={t('同快速模型')}
						/>
					</div>
				)}
				<Field label={t('接口地址')}>
					<TextInput
						value={connection.baseUrl}
						placeholder="https://…"
						disabled={inherited}
						onChange={(baseUrl) => change({ baseUrl })}
					/>
				</Field>
				<Field label={t('模型名')}>
					<TextInput
						value={draft.model}
						placeholder={t('模型名')}
						onChange={(model) => change({ model, context: '', output: '' })}
						onBlur={() => {
							if (lastModel.current !== draft.model) {
								lastModel.current = draft.model
								suggest(draft)
							}
						}}
					/>
				</Field>
				<Field label={t('上下文长度')}>
					<TextInput
						value={draft.context}
						inputMode="numeric"
						placeholder={t('模型上下文窗口 tokens（至少 4096）')}
						onChange={(context) => change({ context })}
					/>
				</Field>
				<Field label={t('最大输出量')}>
					<TextInput
						value={draft.output}
						inputMode="numeric"
						placeholder={t('留空则按模型自动设置')}
						onChange={(output) => change({ output })}
					/>
				</Field>
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
				<Field label={t('接口地址')}>
					<TextInput
						value={draft.baseUrl}
						placeholder="https://…"
						onChange={(baseUrl) => change({ baseUrl })}
					/>
				</Field>
				<Field label={t('模型名')}>
					<TextInput
						value={draft.model}
						placeholder={t('模型名')}
						onChange={(model) => change({ model })}
					/>
				</Field>
				<div className={styles.fullField}>
					<ApiKeyInput
						value={draft.apiKey}
						onChange={(apiKey) => change({ apiKey })}
					/>
				</div>
				<Field label={t('生图质量')}>
					<CompactSelect
						aria-label={t('生图质量')}
						value={draft.quality}
						options={[
							{ value: 'high', label: t('高') },
							{ value: 'medium', label: t('中') },
							{ value: 'low', label: t('低') },
						]}
						onChange={(quality) => change({ quality })}
					/>
				</Field>
				<div className={styles.tooltipField}>
					<span
						className={`label-caps label-caps-zh ${styles.tooltipFieldLabel}`}
					>
						{t('原生长边上限')}
						<InfoTooltip
							label={t('原生长边上限说明')}
							text={t('超出部分由本地放大')}
						/>
					</span>
					<CompactSelect
						aria-label={t('原生长边上限')}
						value={String(draft.nativeMaxEdge)}
						options={[
							{ value: '1536', label: t('1536 · Codex 渠道') },
							{ value: '2048', label: '2048' },
							{ value: '2560', label: t('2560 · OpenAI 官方 API') },
							{ value: '2816', label: '2816 · Seedream 5.x' },
							{
								value: '3840',
								label: t('3840 · 4K（OpenAI 实验 / Seedream 4.5）'),
							},
						]}
						onChange={(value) =>
							change({
								nativeMaxEdge: Number(value) as typeof draft.nativeMaxEdge,
							})
						}
					/>
				</div>
				<Field label={t('同时出图数')}>
					<TextInput
						inputMode="numeric"
						value={draft.concurrency}
						onChange={(concurrency) => change({ concurrency })}
					/>
				</Field>
				<Field label={t('生图失败重试次数')}>
					<TextInput
						inputMode="numeric"
						value={draft.retries}
						onChange={(retries) => change({ retries })}
					/>
				</Field>
				<div className={styles.postProcess}>
					<Field label={t('后处理')}>
						<CompactSelect
							aria-label={t('后处理')}
							value={draft.postProcess}
							options={[
								{ value: 'off', label: t('关') },
								{ value: 'single', label: t('放大降噪（默认）') },
								{ value: 'double', label: t('双重放大降噪') },
							]}
							onChange={(postProcess) => change({ postProcess })}
						/>
					</Field>
					<div className={styles.tooltipField}>
						<span
							className={`label-caps label-caps-zh ${styles.tooltipFieldLabel}`}
						>
							{t('放大档位')}
							{draft.upscaleTier !== 'anime' && (
								<InfoTooltip
									label={t('放大档位说明')}
									text={
										draft.upscaleTier === 'fast'
											? t('低性能机用，画质下降')
											: t('少改原画，保留纹理细节')
									}
								/>
							)}
						</span>
						<CompactSelect
							aria-label={t('放大档位')}
							value={draft.upscaleTier}
							disabled={draft.postProcess === 'off'}
							options={[
								{ value: 'anime', label: t('动漫（默认）') },
								{ value: 'fast', label: t('快速') },
								{ value: 'detail', label: t('保留细节') },
							]}
							onChange={(upscaleTier) => change({ upscaleTier })}
						/>
					</div>
				</div>
			</>
		),
	}
}
