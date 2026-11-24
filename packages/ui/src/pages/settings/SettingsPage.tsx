import type {
	CommandError,
	CommandOutput,
	MaskedConfig,
	TextSlot,
} from '@novelive/creator/contract'
import {
	AlertTriangle,
	BookOpen,
	Brain,
	Cable,
	Check,
	ChevronDown,
	Contrast,
	Eye,
	FilePenLine,
	FolderOpen,
	Globe,
	Image,
	type LucideIcon,
	Zap,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Collapse } from '../../components/Collapse'
import { Page } from '../../components/Page'
import { localeNames, locales, msg, scoped } from '../../i18n'
import type { SettingsHost } from '../../shell/AppShell'
import {
	formatLabel,
	type ModelDraft,
	Select,
	themes,
	useImageFields,
	useTextFields,
} from './ModelFields'
import { ProductionSettings } from './production/ProductionSettings'
import styles from './SettingsPage.module.css'

const t = scoped('settings')

const textSlots = [
	['fast', msg('快速模型'), Zap],
	['main', msg('主模型'), Brain],
	['writing', msg('写作模型'), FilePenLine],
	['visual', msg('视觉模型'), Eye],
] as const
const capabilities = [
	['generate', msg('文生图')],
	['transparent', msg('透明底')],
	['edit', msg('图片编辑')],
] as const

type ImageTests = CommandOutput<'model.testImage'>
type TestResult = ImageTests | CommandOutput<'model.testText'>

export function readableError(error: unknown): CommandError {
	const failure =
		error && typeof error === 'object' && 'code' in error
			? (error as CommandError)
			: undefined
	const code = failure?.code ?? 'internal'
	const readable =
		failure?.message &&
		('localized' in failure || /[\u3400-\u9fff]/.test(failure.message))
			? failure.message
			: undefined
	const message = {
		auth: t('鉴权失败，请检查接口地址、API Key 和模型名。'),
		not_found: t('接口或模型不存在，请检查接口地址和模型名。'),
		network: t(
			'连接中断或服务暂不可用，请检查接口地址、API Key 和模型名后重试。',
		),
		moderation: t('请求被内容审核拒绝。'),
		context_limit: t('内容超出模型的上下文限制，请选择上下文更长的模型。'),
		reasoning_limit: t('模型用完了推理额度，未返回答案。请尝试其他模型。'),
		stale_revision: t('内容已改变，请刷新后重试。'),
		invalid_config:
			readable ?? t('配置无效，请检查接口地址、API Key、模型名和上下文长度。'),
		unsupported: failure?.message ?? t('当前模型不支持此项。'),
		cancelled: t('已取消测试。'),
		creator_down: t('创作端已断开，重新连接后可再测试。'),
		internal: readable ?? t('操作失败，请重试。'),
	}[code]
	return { code, message }
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
	return (
		<span className={styles.icon}>
			<Icon aria-hidden="true" size={19} strokeWidth={1.8} />
		</span>
	)
}

function ImageResults({ results }: { results: ImageTests }) {
	return (
		<section className={styles.results} aria-label={t('图片测试结果')}>
			{capabilities.map(([capability, title]) => {
				const result = results[capability]
				const error = result.ok ? undefined : readableError(result.error)
				return (
					<div key={capability} className={styles.result}>
						<strong>{t(title)}</strong>
						{result.ok ? (
							<>
								<img
									src={window.novelive.resourceUrl(result.thumbnail)}
									alt={t('{{title}}测试缩略图', { title: t(title) })}
								/>
								<span className={styles.success}>{t('测试成功')}</span>
							</>
						) : (
							<small className={styles.error} data-error-code={error?.code}>
								{error?.message}
							</small>
						)}
					</div>
				)
			})}
		</section>
	)
}

function ModelCard({
	title,
	icon,
	summary,
	configured,
	draft,
	testModel,
}: {
	title: string
	icon: LucideIcon
	summary: string
	configured: boolean
	draft: ModelDraft
	testModel(): { promise: Promise<TestResult>; cancel(): void }
}) {
	const [open, setOpen] = useState(false)
	const [phase, setPhase] = useState<'idle' | 'saving' | 'testing'>('idle')
	const [result, setResult] = useState<TestResult>()
	const [error, setError] = useState<CommandError>()
	const [saved, setSaved] = useState(false)
	const work = useRef<AbortController | undefined>(undefined)
	useEffect(() => () => work.current?.abort(), [])
	const busy = phase !== 'idle'
	const images = result && 'generate' in result ? result : undefined
	const complete =
		result && (!images || Object.values(images).every((item) => item.ok))

	async function run(test: boolean) {
		if (work.current) return
		const operation = new AbortController()
		work.current = operation
		setPhase(test ? 'testing' : 'saving')
		setError(undefined)
		setResult(undefined)
		setSaved(false)
		try {
			if (draft.dirty) await draft.save()
			operation.signal.throwIfAborted()
			if (test) {
				const call = testModel()
				operation.signal.addEventListener('abort', call.cancel, { once: true })
				const response = await call.promise
				if ('generate' in response) setOpen(true)
				setResult(response)
			} else setSaved(true)
		} catch (failure) {
			setError(
				readableError(
					operation.signal.aborted ? { code: 'cancelled' } : failure,
				),
			)
		} finally {
			work.current = undefined
			setPhase('idle')
		}
	}

	return (
		<section aria-label={title} className={styles.card}>
			<div className={styles.cardHeader}>
				<button
					className={styles.expand}
					type="button"
					aria-label={title}
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					<IconTile icon={icon} />
					<span className={styles.summary}>
						<strong>{title}</strong>
						<small>{summary || t('未填写模型名')}</small>
					</span>
					<ChevronDown
						className={styles.chevron}
						aria-hidden="true"
						size={18}
					/>
				</button>
				<small className={configured ? styles.success : styles.muted}>
					{configured ? t('已配置') : t('未配置')}
				</small>
				{phase === 'testing' ? (
					<button
						className={styles.testButton}
						type="button"
						onClick={() => work.current?.abort()}
					>
						{t('取消')}
					</button>
				) : (
					<button
						className={styles.testButton}
						type="button"
						disabled={busy}
						onClick={() => void run(true)}
					>
						<Cable size={14} aria-hidden="true" /> {t('测试')}
					</button>
				)}
			</div>
			{(busy || result || error || (saved && !draft.dirty)) && (
				<p
					role="status"
					className={`${styles.feedback} ${error ? styles.error : complete ? styles.success : ''}`}
					data-error-code={error?.code}
				>
					{phase === 'testing' ? (
						t('正在测试…')
					) : phase === 'saving' ? (
						t('正在保存…')
					) : error ? (
						error.message
					) : complete ? (
						<>
							<Check size={14} aria-hidden="true" /> {t('连接成功')}
						</>
					) : images ? (
						t('测试完成，请查看各项结果。')
					) : (
						t('已保存')
					)}
				</p>
			)}
			<Collapse open={open}>
				<div className={styles.editor}>
					{images && <ImageResults results={images} />}
					<fieldset className={styles.fields} disabled={busy}>
						{draft.fields}
					</fieldset>
					<div className={styles.actions}>
						<button
							type="button"
							disabled={busy || !draft.dirty}
							onClick={() => void run(false)}
						>
							{t('保存')}
						</button>
					</div>
				</div>
			</Collapse>
		</section>
	)
}

function TextCard({
	slot,
	title,
	icon,
	models,
	update,
}: {
	slot: TextSlot
	title: string
	icon: LucideIcon
	models: MaskedConfig['models']
	update: SettingsHost['updateConfig']
}) {
	const model = models[slot]
	const draft = useTextFields(slot, model, models.fast, update)
	const connection =
		'inheritFast' in model && model.inheritFast ? models.fast : model
	return (
		<ModelCard
			title={title}
			icon={icon}
			summary={[
				model.model || t('未填模型'),
				formatLabel(connection.format),
				slot !== 'fast' && 'inheritFast' in model && model.inheritFast
					? t('同快速模型')
					: '',
			]
				.filter(Boolean)
				.join(' · ')}
			configured={Boolean(
				model.model && connection.baseUrl && connection.apiKeyMasked,
			)}
			draft={draft}
			testModel={() => window.novelive.call('model.testText', { slot })}
		/>
	)
}

function ImageCard({
	model,
	update,
}: {
	model: MaskedConfig['models']['image']
	update: SettingsHost['updateConfig']
}) {
	const draft = useImageFields(model, update)
	return (
		<ModelCard
			title={t('图片模型')}
			icon={Image}
			summary={model.model || t('未填模型')}
			configured={Boolean(model.model && model.baseUrl && model.apiKeyMasked)}
			draft={draft}
			testModel={() => window.novelive.call('model.testImage', {})}
		/>
	)
}

/** Model cards shared by settings and the welcome flow. */
export function ModelCards({
	models,
	update,
}: {
	models: MaskedConfig['models']
	update: SettingsHost['updateConfig']
}) {
	return (
		<div className={`${styles.page} ${styles.cards}`}>
			{textSlots.map(([slot, title, icon]) => (
				<TextCard
					key={slot}
					slot={slot}
					title={t(title)}
					icon={icon}
					models={models}
					update={update}
				/>
			))}
			<ImageCard model={models.image} update={update} />
		</div>
	)
}

function SettingRow({
	title,
	icon,
	children,
}: {
	title: string
	icon: LucideIcon
	children: ReactNode
}) {
	return (
		<div className={styles.row}>
			<IconTile icon={icon} />
			<strong>{title}</strong>
			{children}
		</div>
	)
}

export function SettingsPage() {
	const { config, updateConfig, resetConfig } = useOutletContext<SettingsHost>()
	const [error, setError] = useState('')
	const [resetting, setResetting] = useState(false)
	const [about, setAbout] = useState<{ version: string; packaged: boolean }>()
	const [checkingUpdates, setCheckingUpdates] = useState(false)
	const aboutHost = window.novelive.host.about
	useEffect(() => {
		void aboutHost?.info().then(setAbout, () => setAbout(undefined))
	}, [aboutHost])
	async function apply(action: () => Promise<unknown>) {
		setError('')
		try {
			await action()
		} catch (failure) {
			setError(readableError(failure).message)
		}
	}
	return (
		<Page title={t('设置')} width={760}>
			<div className={styles.page}>
				{error && (
					<p role="alert" className={styles.warning}>
						{error}
					</p>
				)}
				{!config ? (
					<p className={styles.muted}>{t('正在读取设置…')}</p>
				) : 'configError' in config ? (
					<div className={styles.warning} role="alert">
						<AlertTriangle size={19} aria-hidden="true" />
						<div>
							<strong>{t('配置文件无法读取')}</strong>
							<p>{config.configError.reason}</p>
							<p className={styles.path}>{config.configError.path}</p>
						</div>
						<button
							type="button"
							disabled={resetting}
							onClick={() => {
								setResetting(true)
								void apply(resetConfig).finally(() => setResetting(false))
							}}
						>
							{t('重置配置')}
						</button>
					</div>
				) : (
					<>
						<section aria-labelledby="model-settings">
							<h2 id="model-settings" className="label-caps label-caps-zh">
								{t('模型')}
							</h2>
							<ModelCards models={config.models} update={updateConfig} />
							<ProductionSettings
								config={config.production}
								update={updateConfig}
							/>
						</section>
						<section aria-labelledby="appearance-settings">
							<h2 id="appearance-settings" className="label-caps label-caps-zh">
								{t('界面')}
							</h2>
							<div className={`${styles.card} ${styles.appearance}`}>
								<SettingRow title={t('界面语言')} icon={Globe}>
									<Select
										label={t('界面语言')}
										options={locales.map(
											(locale) => [locale, localeNames[locale]] as const,
										)}
										value={config.language}
										onChange={(language) =>
											void apply(() => updateConfig({ language }))
										}
									/>
								</SettingRow>
								<SettingRow title={t('主题')} icon={Contrast}>
									<Select
										label={t('主题')}
										options={themes.map(
											([value, name]) => [value, t(name)] as const,
										)}
										value={config.theme}
										onChange={(theme) =>
											void apply(() => updateConfig({ theme }))
										}
									/>
								</SettingRow>
							</div>
						</section>
						<section aria-labelledby="project-settings">
							<h2 id="project-settings" className="label-caps label-caps-zh">
								{t('工程')}
							</h2>
							<div className={styles.card}>
								<SettingRow title={t('默认工程位置')} icon={FolderOpen}>
									<small className={styles.path}>
										{config.projectDir || t('未设置')}
									</small>
									<button
										type="button"
										onClick={() =>
											void apply(async () => {
												const projectDir = await window.novelive.pickFolder()
												if (projectDir !== null)
													await updateConfig({ projectDir })
											})
										}
									>
										{t('更改')}
									</button>
								</SettingRow>
							</div>
						</section>
					</>
				)}
				<section aria-labelledby="about-settings">
					<h2 id="about-settings" className="label-caps label-caps-zh">
						{t('关于')}
					</h2>
					<div className={`${styles.card} ${styles.about}`}>
						<div className={styles.row}>
							<IconTile icon={BookOpen} />
							<span>
								<strong>Novelive</strong>
								<small>{t('把小说改编为视觉小说并直接游玩。')}</small>
							</span>
							<small>{about && `v${about.version} · `}AGPL-3.0</small>
						</div>
						{aboutHost && (
							<div className={styles.aboutLinks}>
								<button
									type="button"
									onClick={() => void apply(() => aboutHost.open('license'))}
								>
									{t('开源许可')}
								</button>
								{about?.packaged && (
									<button
										type="button"
										onClick={() => void apply(() => aboutHost.open('notices'))}
									>
										{t('第三方许可')}
									</button>
								)}
								<button
									type="button"
									onClick={() => void apply(() => aboutHost.open('source'))}
								>
									{t('源代码')}
								</button>
								<button
									type="button"
									disabled={checkingUpdates}
									onClick={() => {
										setCheckingUpdates(true)
										void apply(() => aboutHost.checkUpdates()).finally(() =>
											setCheckingUpdates(false),
										)
									}}
								>
									{checkingUpdates ? t('正在检查…') : t('检查更新')}
								</button>
							</div>
						)}
					</div>
				</section>
			</div>
		</Page>
	)
}
