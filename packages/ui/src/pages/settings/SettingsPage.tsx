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
	CircleCheck,
	Contrast,
	ExternalLink,
	Eye,
	FilePenLine,
	FolderOpen,
	Globe,
	Image,
	type LucideIcon,
	RefreshCw,
	RotateCcw,
	X,
	Zap,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Button, Spinner } from '../../components/Button'
import { Card } from '../../components/Card'
import { Collapse } from '../../components/Collapse'
import { Banner } from '../../components/Extended'
import { Details, ErrorNotice, LoadingState } from '../../components/Feedback'
import { CompactSelect } from '../../components/Form'
import { Modal } from '../../components/Modal'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { formatPath, useHomeDir } from '../../format/path'
import { localeNames, locales, msg, scoped } from '../../i18n'
import type { SettingsHost } from '../../shell/AppShell'
import {
	type ModelDraft,
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

/**
 * 主要第三方组件许可一览；完整许可文本随应用分发
 * （打包版见 licenses/THIRD_PARTY_NOTICES.txt，可用右侧按钮打开原文）。
 */
const thirdPartyLicenses: ReadonlyArray<readonly [string, string]> = [
	['React & React DOM', 'MIT License'],
	['React Router', 'MIT License'],
	['lucide-react', 'ISC License'],
	['CodeMirror 6', 'MIT License'],
	['Electron', 'MIT License'],
	['sharp / libvips', 'LGPL-3.0-or-later'],
	['Real-ESRGAN', 'BSD-3-Clause License'],
	['upscayl-ncnn', 'AGPL-3.0 License'],
	['Noto Sans SC / Noto Serif SC', 'SIL Open Font License 1.1'],
]

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
						<span
							className={`${styles.resultHead} ${result.ok ? styles.success : styles.error}`}
						>
							{result.ok ? (
								<CircleCheck size={14} strokeWidth={1.8} aria-hidden="true" />
							) : (
								<AlertTriangle size={14} strokeWidth={1.8} aria-hidden="true" />
							)}
							{t(title)} · {result.ok ? t('测试成功') : t('未通过')}
						</span>
						{result.ok ? (
							<img
								src={window.novelive.resourceUrl(result.thumbnail)}
								alt={t('{{title}}测试缩略图', { title: t(title) })}
							/>
						) : (
							<small
								className={styles.errorBadge}
								data-error-code={error?.code}
							>
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
	const toast = useToast()
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
			} else {
				setSaved(true)
				toast(t('已保存'), Check)
			}
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

	const feedbackIcon = error ? (
		<AlertTriangle size={14} strokeWidth={1.8} aria-hidden="true" />
	) : complete ? (
		<CircleCheck size={14} strokeWidth={1.8} aria-hidden="true" />
	) : null

	return (
		<section aria-label={title} className={`glass-panel ${styles.card}`}>
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
						strokeWidth={1.8}
					/>
				</button>
				<small className={configured ? styles.configured : styles.muted}>
					{configured ? t('已配置') : t('未配置')}
				</small>
				{phase === 'testing' ? (
					<Button
						size="sm"
						className={styles.testButton}
						onClick={() => work.current?.abort()}
					>
						{t('取消')}
					</Button>
				) : (
					<Button
						size="sm"
						icon={Cable}
						className={styles.testButton}
						disabled={busy}
						onClick={() => void run(true)}
					>
						{t('测试')}
					</Button>
				)}
				{phase === 'testing' ? (
					<span className={`${styles.statusNote} ${styles.muted}`}>
						<Spinner size={13} />
					</span>
				) : error ? (
					<span className={`${styles.statusNote} ${styles.error}`}>
						<X size={14} strokeWidth={1.8} aria-hidden="true" />
					</span>
				) : complete ? (
					<span className={`${styles.statusNote} ${styles.success}`}>
						<CircleCheck size={14} strokeWidth={1.8} aria-hidden="true" />
					</span>
				) : null}
			</div>
			{(busy || result || error || (saved && !draft.dirty)) && (
				<p
					role="status"
					className={`${styles.feedback} ${error ? styles.error : complete ? styles.success : ''}`}
					data-error-code={error?.code}
				>
					{phase === 'testing' ? (
						<>
							<Spinner size={13} /> {t('正在测试…')}
						</>
					) : phase === 'saving' ? (
						t('正在保存…')
					) : error ? (
						<>
							{feedbackIcon} {error.message}
						</>
					) : complete ? (
						<>
							{feedbackIcon} {t('连接成功')}
						</>
					) : images ? (
						t('测试完成，请查看各项结果。')
					) : (
						<>
							<Check size={14} strokeWidth={1.8} aria-hidden="true" />{' '}
							{t('已保存')}
						</>
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
						<Button
							size="sm"
							disabled={busy || !draft.dirty}
							onClick={() => void run(false)}
						>
							{t('保存')}
						</Button>
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
		<div className={styles.cards}>
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
	const toast = useToast()
	const [error, setError] = useState('')
	const [resetting, setResetting] = useState(false)
	const [about, setAbout] = useState<{ version: string; packaged: boolean }>()
	const [checkingUpdates, setCheckingUpdates] = useState(false)
	const [licensesOpen, setLicensesOpen] = useState(false)
	const home = useHomeDir()
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
				{error && <ErrorNotice message={error} />}
				{!config ? (
					<LoadingState text={t('正在读取设置…')} />
				) : 'configError' in config ? (
					<div role="alert" className={styles.configError}>
						<Banner
							kind="error"
							action={
								<Button
									size="sm"
									variant="ghost"
									icon={RotateCcw}
									disabled={resetting}
									onClick={() => {
										setResetting(true)
										void apply(async () => {
											await resetConfig()
											toast(t('配置已重置'), RotateCcw)
										}).finally(() => setResetting(false))
									}}
								>
									{t('重置配置')}
								</Button>
							}
						>
							<strong>{t('配置文件无法读取')}</strong>
							{config.configError.reason}
						</Banner>
						<Details>
							<span className={styles.path}>
								{formatPath(config.configError.path, home)}
							</span>
						</Details>
					</div>
				) : (
					<>
						<section aria-labelledby="model-settings">
							<h2 id="model-settings" className="label-caps label-caps-zh">
								{t('模型')}
							</h2>
							<ModelCards models={config.models} update={updateConfig} />
						</section>
						<ProductionSettings
							config={config.production}
							update={updateConfig}
						/>
						<section aria-labelledby="appearance-settings">
							<h2 id="appearance-settings" className="label-caps label-caps-zh">
								{t('界面')}
							</h2>
							<Card className={styles.appearance}>
								<SettingRow title={t('界面语言')} icon={Globe}>
									<CompactSelect
										aria-label={t('界面语言')}
										className={styles.rowSelect}
										options={locales.map((locale) => ({
											value: locale,
											label: localeNames[locale],
										}))}
										value={config.language}
										onChange={(language) =>
											void apply(() => updateConfig({ language }))
										}
									/>
								</SettingRow>
								<SettingRow title={t('主题')} icon={Contrast}>
									<CompactSelect
										aria-label={t('主题')}
										className={styles.rowSelect}
										options={themes.map(([value, name]) => ({
											value,
											label: t(name),
										}))}
										value={config.theme}
										onChange={(theme) =>
											void apply(() => updateConfig({ theme }))
										}
									/>
								</SettingRow>
							</Card>
						</section>
						<section aria-labelledby="project-settings">
							<h2 id="project-settings" className="label-caps label-caps-zh">
								{t('工程')}
							</h2>
							<Card>
								<SettingRow title={t('默认工程位置')} icon={FolderOpen}>
									<small
										className={styles.path}
										title={config.projectDir || undefined}
									>
										{config.projectDir
											? formatPath(config.projectDir, home)
											: t('未设置')}
									</small>
									<Button
										size="sm"
										icon={FolderOpen}
										onClick={() =>
											void apply(async () => {
												const projectDir = await window.novelive.pickFolder()
												if (projectDir !== null)
													await updateConfig({ projectDir })
											})
										}
									>
										{t('更改')}
									</Button>
								</SettingRow>
							</Card>
						</section>
					</>
				)}
				<section aria-labelledby="about-settings">
					<h2 id="about-settings" className="label-caps label-caps-zh">
						{t('关于')}
					</h2>
					<Card className={styles.about}>
						<div className={styles.aboutBrand}>
							<IconTile icon={BookOpen} />
							<div className={styles.aboutNames}>
								<span className={styles.aboutTitleRow}>
									<strong>Novelive</strong>
									<small className={styles.aboutVersion}>
										{about ? `v${about.version} · ` : ''}AGPL-3.0
									</small>
								</span>
								<small className={styles.aboutTagline}>
									{t('把小说改编为视觉小说并直接游玩。')}
								</small>
							</div>
						</div>
						{aboutHost && (
							<div className={styles.aboutLinks}>
								<button
									type="button"
									onClick={() => void apply(() => aboutHost.open('license'))}
								>
									<ExternalLink
										size={12}
										strokeWidth={1.8}
										aria-hidden="true"
									/>
									{t('开源许可')}
								</button>
								<button type="button" onClick={() => setLicensesOpen(true)}>
									<ExternalLink
										size={12}
										strokeWidth={1.8}
										aria-hidden="true"
									/>
									{t('第三方许可')}
								</button>
								<button
									type="button"
									onClick={() => void apply(() => aboutHost.open('source'))}
								>
									<ExternalLink
										size={12}
										strokeWidth={1.8}
										aria-hidden="true"
									/>
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
									<RefreshCw size={12} strokeWidth={1.8} aria-hidden="true" />
									{checkingUpdates ? t('正在检查…') : t('检查更新')}
								</button>
							</div>
						)}
					</Card>
				</section>
			</div>
			<Modal
				open={licensesOpen}
				title={t('第三方许可')}
				onClose={() => setLicensesOpen(false)}
				width={520}
				footer={
					<>
						{about?.packaged && aboutHost ? (
							<Button
								variant="ghost"
								icon={ExternalLink}
								onClick={() =>
									void apply(async () => {
										await aboutHost.open('notices')
										setLicensesOpen(false)
									})
								}
							>
								{t('打开完整文本')}
							</Button>
						) : null}
						<Button variant="primary" onClick={() => setLicensesOpen(false)}>
							{t('关闭')}
						</Button>
					</>
				}
			>
				<div className={styles.licenses}>
					{thirdPartyLicenses.map(([name, license], index) => (
						<div
							key={name}
							className={styles.licenseRow}
							data-first={index === 0 || undefined}
						>
							<strong>{name}</strong>
							<span>{license}</span>
						</div>
					))}
				</div>
			</Modal>
		</Page>
	)
}
