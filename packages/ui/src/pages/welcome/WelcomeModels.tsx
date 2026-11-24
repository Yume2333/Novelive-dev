import type { ConfigUpdate, MaskedConfig } from '@novelive/creator/contract'
import { Cable, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { msg, scoped } from '../../i18n'
import { Select } from '../settings/ModelFields'
import { readableError } from '../settings/SettingsPage'
import styles from './WelcomePage.module.css'

const t = scoped('settings')
const slots = [
	['fast', msg('快速模型')],
	['main', msg('主模型')],
	['writing', msg('写作模型')],
	['visual', msg('视觉模型')],
] as const
const formats = [
	['openai-completions', 'OpenAI Chat Completions'],
	['openai-responses', 'OpenAI Responses'],
	['anthropic-messages', 'Anthropic Messages'],
] as const

export function WelcomeModels({
	models,
	update,
	onDone,
}: {
	models: MaskedConfig['models']
	update(patch: ConfigUpdate): Promise<MaskedConfig>
	onDone(): void
}) {
	const [format, setFormat] = useState(models.fast.format)
	const [baseUrl, setBaseUrl] = useState(models.fast.baseUrl)
	const [apiKey, setApiKey] = useState<string>(models.fast.apiKeyMasked)
	const [names, setNames] = useState({
		fast: models.fast.model,
		main: models.main.model,
		writing: models.writing.model,
		visual: models.visual.model,
	})
	const [image, setImage] = useState({
		baseUrl: models.image.baseUrl,
		model: models.image.model,
		apiKey: models.image.apiKeyMasked as string,
	})
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [tested, setTested] = useState(false)
	const operation = useRef<AbortController | undefined>(undefined)
	useEffect(() => () => operation.current?.abort(), [])

	function patch(): ConfigUpdate {
		const sharedChanged =
			format !== models.fast.format ||
			baseUrl.trim() !== models.fast.baseUrl ||
			apiKey !== models.fast.apiKeyMasked
		return {
			models: {
				fast: {
					model: names.fast.trim(),
					format,
					baseUrl: baseUrl.trim(),
					apiKey,
					...(format !== models.fast.format ? { compat: 'auto' } : {}),
				},
				...Object.fromEntries(
					slots.slice(1).map(([slot]) => [
						slot,
						{
							model: names[slot].trim(),
							...(sharedChanged ? { inheritFast: true } : {}),
						},
					]),
				),
				image: {
					...image,
					baseUrl: image.baseUrl.trim(),
					model: image.model.trim(),
				},
			},
		}
	}

	async function save(test: boolean) {
		if (operation.current) return
		const active = new AbortController()
		operation.current = active
		setBusy(true)
		setError('')
		setTested(false)
		try {
			await update(patch())
			active.signal.throwIfAborted()
			if (test) {
				const request = window.novelive.call('model.testText', {
					slot: 'fast',
				})
				active.signal.addEventListener('abort', request.cancel, { once: true })
				await request.promise
				active.signal.throwIfAborted()
				setTested(true)
			} else onDone()
		} catch (cause) {
			if (!active.signal.aborted) setError(readableError(cause).message)
		} finally {
			operation.current = undefined
			setBusy(false)
		}
	}

	function field(
		label: string,
		value: string,
		change: (value: string) => void,
		secret = false,
	) {
		return (
			<label className={styles.modelField}>
				<span>{label}</span>
				<input
					type={secret ? 'password' : 'text'}
					value={value}
					autoComplete={secret ? 'new-password' : 'off'}
					onFocus={(event) => {
						if (secret && value === '••••') event.currentTarget.select()
					}}
					onChange={(event) => {
						change(event.target.value)
						setTested(false)
					}}
				/>
			</label>
		)
	}

	return (
		<form
			id="welcome-model-config"
			onSubmit={(event) => {
				event.preventDefault()
				void save(false)
			}}
		>
			<fieldset className={styles.modelForm} disabled={busy}>
				<div className={styles.modelGrid}>
					<div className={styles.modelField}>
						<span>{t('接口格式')}</span>
						<Select
							label={t('接口格式')}
							value={format}
							options={formats}
							onChange={(value) => {
								setFormat(value)
								setTested(false)
							}}
						/>
					</div>
					{field(t('接口地址'), baseUrl, setBaseUrl)}
				</div>
				{field('API Key', apiKey, setApiKey, true)}
				<div className={styles.modelTest}>
					<Button size="sm" onClick={() => void save(true)} loading={busy}>
						<Cable size={14} aria-hidden="true" />
						{t('测试')}
					</Button>
					{tested && (
						<span role="status">
							<Check size={14} aria-hidden="true" />
							{t('连接成功')}
						</span>
					)}
				</div>
				<div className={styles.modelGrid}>
					{slots.map(([slot, title]) => (
						<div key={slot}>
							{field(t(title), names[slot], (value) =>
								setNames((previous) => ({ ...previous, [slot]: value })),
							)}
						</div>
					))}
				</div>
				<div className={styles.imageModels}>
					{field(
						`${t('图片模型')} · ${t('接口地址')}`,
						image.baseUrl,
						(value) =>
							setImage((previous) => ({ ...previous, baseUrl: value })),
					)}
					{field(t('模型名'), image.model, (value) =>
						setImage((previous) => ({ ...previous, model: value })),
					)}
					{field(
						'API Key',
						image.apiKey,
						(value) => setImage((previous) => ({ ...previous, apiKey: value })),
						true,
					)}
				</div>
			</fieldset>
			{error && <p role="alert">{error}</p>}
		</form>
	)
}
