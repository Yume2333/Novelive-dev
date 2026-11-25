import type { ConfigUpdate, MaskedConfig } from '@novelive/creator/contract'
import { Cable, Check, CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Select, TextInput } from '../../components/Form'
import { msg, scoped } from '../../i18n'
import { readableError } from '../settings/SettingsPage'
import styles from './WelcomePage.module.css'

const t = scoped('welcome')
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
					<Field label={t('接口格式')}>
						<Select
							aria-label={t('接口格式')}
							value={format}
							options={formats.map(([value, label]) => ({ value, label }))}
							onChange={(value) => {
								setFormat(value)
								setTested(false)
							}}
						/>
					</Field>
					<Field label={t('接口地址')}>
						<TextInput
							value={baseUrl}
							placeholder="https://…"
							autoComplete="off"
							onChange={(value) => {
								setBaseUrl(value)
								setTested(false)
							}}
						/>
					</Field>
				</div>
				<Field label="API Key">
					<TextInput
						type="password"
						value={apiKey}
						placeholder="sk-…"
						autoComplete="new-password"
						onFocus={(event) => {
							if (apiKey === '••••') event.currentTarget.select()
						}}
						onChange={(value) => {
							setApiKey(value)
							setTested(false)
						}}
					/>
				</Field>
				<div className={styles.modelTest}>
					<Button
						size="sm"
						icon={Cable}
						loading={busy}
						onClick={() => void save(true)}
					>
						{t('测试连接')}
					</Button>
					{tested && (
						<span role="status" className={styles.testOk}>
							<Check size={14} strokeWidth={1.8} aria-hidden="true" />
							{t('连接成功')}
						</span>
					)}
					{error && (
						<span role="alert" className={styles.testFail}>
							<CircleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
							{error}
						</span>
					)}
				</div>
				<div className={styles.modelGrid}>
					{slots.map(([slot, title]) => (
						<Field key={slot} label={t(title)}>
							<TextInput
								value={names[slot]}
								placeholder={t('模型名')}
								autoComplete="off"
								onChange={(value) =>
									setNames((previous) => ({ ...previous, [slot]: value }))
								}
							/>
						</Field>
					))}
				</div>
				<div className={styles.imageModels}>
					<Field label={`${t('图片模型')} · ${t('接口地址')}`}>
						<TextInput
							value={image.baseUrl}
							placeholder="https://…/v1"
							autoComplete="off"
							onChange={(value) =>
								setImage((previous) => ({ ...previous, baseUrl: value }))
							}
						/>
					</Field>
					<Field label={t('模型名')}>
						<TextInput
							value={image.model}
							placeholder={t('模型名')}
							autoComplete="off"
							onChange={(value) =>
								setImage((previous) => ({ ...previous, model: value }))
							}
						/>
					</Field>
					<Field label="API Key">
						<TextInput
							type="password"
							value={image.apiKey}
							placeholder="sk-…"
							autoComplete="new-password"
							onFocus={(event) => {
								if (image.apiKey === '••••') event.currentTarget.select()
							}}
							onChange={(value) =>
								setImage((previous) => ({ ...previous, apiKey: value }))
							}
						/>
					</Field>
				</div>
			</fieldset>
		</form>
	)
}
