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
	Eye,
	FilePenLine,
	FolderOpen,
	Globe,
	Image,
	type LucideIcon,
	Palette,
	Zap,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Collapse } from '../../components/Collapse'
import type { SettingsHost } from '../../shell/AppShell'
import {
	type ModelDraft,
	Select,
	themes,
	useImageFields,
	useTextFields,
} from './ModelFields'
import styles from './SettingsPage.module.css'

const textSlots = [
	['fast', '快速模型', Zap],
	['main', '主模型', Brain],
	['writing', '写作模型', FilePenLine],
	['visual', '视觉模型', Eye],
] as const
const capabilities = [
	['generate', '文生图'],
	['transparent', '透明底'],
	['edit', '图片编辑'],
] as const

type ImageTests = CommandOutput<'model.testImage'>
type TestResult = ImageTests | CommandOutput<'model.testText'>

function readableError(error: unknown): CommandError {
	const failure =
		error && typeof error === 'object' && 'code' in error
			? (error as CommandError)
			: undefined
	const code = failure?.code ?? 'internal'
	const message = {
		auth: '鉴权失败，请检查接口地址、API Key 和模型名。',
		not_found: '接口或模型不存在，请检查接口地址和模型名。',
		network: '连接中断或服务暂不可用，请检查接口地址、API Key 和模型名后重试。',
		moderation: '请求被内容审核拒绝。',
		invalid_config:
			failure?.message && /[\u3400-\u9fff]/.test(failure.message)
				? failure.message
				: '配置无效，请检查接口地址、API Key、模型名和上下文长度。',
		unsupported: failure?.message ?? '当前模型不支持此项。',
		cancelled: '已取消测试。',
		creator_down: '创作端已断开，重新连接后可再测试。',
		internal:
			failure?.message && /[\u3400-\u9fff]/.test(failure.message)
				? failure.message
				: '操作失败，请重试。',
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
		<section className={styles.results} aria-label="图片测试结果">
			{capabilities.map(([capability, title]) => {
				const result = results[capability]
				const error = result.ok ? undefined : readableError(result.error)
				return (
					<div key={capability} className={styles.result}>
						<strong>{title}</strong>
						{result.ok ? (
							<>
								<img
									src={window.novelive.resourceUrl(result.thumbnail)}
									alt={`${title}测试缩略图`}
								/>
								<span className={styles.success}>测试成功</span>
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
						<small>{summary || '未填写模型名'}</small>
					</span>
					<ChevronDown
						className={styles.chevron}
						aria-hidden="true"
						size={18}
					/>
				</button>
				<small className={configured ? styles.success : styles.muted}>
					{configured ? '已配置' : '未配置'}
				</small>
				{phase === 'testing' ? (
					<button
						className={styles.testButton}
						type="button"
						onClick={() => work.current?.abort()}
					>
						取消
					</button>
				) : (
					<button
						className={styles.testButton}
						type="button"
						disabled={busy}
						onClick={() => void run(true)}
					>
						<Cable size={14} aria-hidden="true" /> 测试
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
						'正在测试…'
					) : phase === 'saving' ? (
						'正在保存…'
					) : error ? (
						error.message
					) : complete ? (
						<>
							<Check size={14} aria-hidden="true" /> 连接成功
						</>
					) : images ? (
						'测试完成，请查看各项结果。'
					) : (
						'已保存'
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
							保存
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
			summary={[model.model, connection.baseUrl].filter(Boolean).join(' · ')}
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
			title="图片模型"
			icon={Image}
			summary={[model.model, model.baseUrl].filter(Boolean).join(' · ')}
			configured={Boolean(model.model && model.baseUrl && model.apiKeyMasked)}
			draft={draft}
			testModel={() => window.novelive.call('model.testImage', {})}
		/>
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
	async function apply(action: () => Promise<unknown>) {
		setError('')
		try {
			await action()
		} catch (failure) {
			setError(readableError(failure).message)
		}
	}
	return (
		<section className={styles.page}>
			<h1>设置</h1>
			{error && (
				<p role="alert" className={styles.warning}>
					{error}
				</p>
			)}
			{!config ? (
				<p className={styles.muted}>正在读取设置…</p>
			) : 'configError' in config ? (
				<div className={styles.warning} role="alert">
					<AlertTriangle size={19} aria-hidden="true" />
					<div>
						<strong>配置文件无法读取</strong>
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
						重置配置
					</button>
				</div>
			) : (
				<>
					<section aria-labelledby="model-settings">
						<h2 id="model-settings">模型</h2>
						<div className={styles.cards}>
							{textSlots.map(([slot, title, icon]) => (
								<TextCard
									key={slot}
									slot={slot}
									title={title}
									icon={icon}
									models={config.models}
									update={updateConfig}
								/>
							))}
							<ImageCard model={config.models.image} update={updateConfig} />
						</div>
					</section>
					<section aria-labelledby="appearance-settings">
						<h2 id="appearance-settings">界面</h2>
						<div className={styles.card}>
							<SettingRow title="界面语言" icon={Globe}>
								<Select
									label="界面语言"
									options={[['zh-CN', '简体中文']]}
									value={config.language}
									onChange={(language) =>
										void apply(() => updateConfig({ language }))
									}
								/>
							</SettingRow>
							<SettingRow title="主题" icon={Palette}>
								<Select
									label="主题"
									options={themes}
									value={config.theme}
									onChange={(theme) =>
										void apply(() => updateConfig({ theme }))
									}
								/>
							</SettingRow>
						</div>
					</section>
					<section aria-labelledby="project-settings">
						<h2 id="project-settings">工程</h2>
						<div className={styles.card}>
							<SettingRow title="默认工程位置" icon={FolderOpen}>
								<small className={styles.path}>
									{config.projectDir || '未设置'}
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
									更改
								</button>
							</SettingRow>
						</div>
					</section>
					<section aria-labelledby="about-settings">
						<h2 id="about-settings">关于</h2>
						<div className={`${styles.card} ${styles.about}`}>
							<div className={styles.row}>
								<IconTile icon={BookOpen} />
								<span>
									<strong>Novelive</strong>
									<small>把小说改编为视觉小说并直接游玩。</small>
								</span>
								<small>v0.1.0 · AGPL-3.0</small>
							</div>
							<div className={styles.aboutLinks}>
								<span>第三方许可（待提供）</span>
								<span>源代码（待接入）</span>
							</div>
						</div>
					</section>
				</>
			)}
		</section>
	)
}
