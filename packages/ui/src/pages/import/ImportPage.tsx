import type {
	CommandError,
	CommandInput,
	CommandOutput,
} from '@novelive/creator/contract'
import {
	ArrowLeft,
	ArrowRight,
	Check,
	FileText,
	FolderOpen,
	ImagePlus,
	Merge,
	Scissors,
	SplitSquareVertical,
	Upload,
	WandSparkles,
	X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Page } from '../../components/Page'
import { msg, scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import type { SettingsHost } from '../../shell/AppShell'
import styles from './ImportPage.module.css'
import {
	chapterLength,
	type ImportLayout,
	isVolumeStart,
	mergeChapter,
	mergeVolume,
	renameChapter,
	renameVolume,
	splitChapter,
	startVolume,
} from './layout'

const t = scoped('import')

type Result = CommandOutput<'import.file'>
type Wizard = Extract<Result, { status: 'ready' }>
type Candidates = Extract<Result, { status: 'encoding' }>['candidates']
type Encoding = NonNullable<CommandInput<'import.file'>['encoding']>

const languages = [
	['zh-CN', msg('简体中文')],
	['zh-TW', msg('繁体中文')],
	['ja', msg('日语')],
	['en', msg('英语')],
	['ko', msg('韩语')],
] as const
const encodingNames: Record<Encoding, string> = {
	'utf-8': 'UTF-8',
	gb18030: msg('GB18030（简体）'),
	big5: msg('Big5（繁体）'),
	shift_jis: msg('Shift_JIS（日文）'),
	'utf-16le': 'UTF-16 LE',
	'utf-16be': 'UTF-16 BE',
}

const steps = [msg('选择文件'), msg('核对信息'), msg('改编设置')]

function Stepper({ current }: { current: number }) {
	return (
		<ol className={styles.stepper} aria-label={t('导入步骤')}>
			{steps.map((step, index) => (
				<li
					key={step}
					data-state={
						index === current ? 'current' : index < current ? 'done' : 'todo'
					}
					aria-current={index === current ? 'step' : undefined}
				>
					<span className={styles.step}>
						{index < current ? (
							<Check aria-hidden="true" size={14} />
						) : (
							<b>{index + 1}</b>
						)}
						{t(step)}
					</span>
				</li>
			))}
		</ol>
	)
}

function PickerField({
	label,
	children,
}: {
	label: string
	children: ReactNode
}) {
	return (
		<div className={styles.field}>
			<span className={styles.label}>{label}</span>
			<span className={styles.picker}>{children}</span>
		</div>
	)
}

function Field({
	label,
	hint,
	children,
}: {
	label: string
	hint?: string
	children: ReactNode
}) {
	return (
		<div className={styles.field}>
			{/* biome-ignore lint/a11y/noLabelWithoutControl: every Field wraps its own control */}
			<label className={styles.field}>
				<span className={styles.label}>{label}</span>
				{children}
			</label>
			{hint && <span className={styles.hint}>{hint}</span>}
		</div>
	)
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const message = (error: unknown) =>
	error && typeof error === 'object' && 'message' in error
		? String((error as CommandError).message)
		: t('导入失败，请重试。')

export function ImportPage() {
	const { config } = useOutletContext<SettingsHost>()
	const navigate = useNavigate()
	const [source, setSource] = useState('')
	const [title, setTitle] = useState('')
	const [folder, setFolder] = useState<string>()
	const [references, setReferences] = useState<string[]>([])
	const [selectedIllustrations, setSelectedIllustrations] = useState<string[]>(
		[],
	)
	const [candidates, setCandidates] = useState<Candidates>()
	const [encoding, setEncoding] = useState<Encoding>()
	const [wizard, setWizard] = useState<Wizard>()
	const [joining, setJoining] = useState(false)
	const [joinTarget, setJoinTarget] = useState<CommandOutput<'import.target'>>()
	const [joined, setJoined] = useState<Extract<Result, { status: 'joined' }>>()
	const [layout, setLayout] = useState<ImportLayout>()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const location =
		folder ?? (config && 'projectDir' in config ? config.projectDir : '')

	async function run(action: () => Promise<void>) {
		setBusy(true)
		setError('')
		try {
			await action()
		} catch (failure) {
			setError(message(failure))
		} finally {
			setBusy(false)
		}
	}

	const pickSource = () =>
		run(async () => {
			const [path] = await window.novelive.pickFiles('source')
			if (!path) return
			setSource(path)
			setTitle(
				fileName(path).replace(/\.(txt|epub|md|markdown|docx|pdf)$/i, ''),
			)
			setCandidates(undefined)
			setEncoding(undefined)
		})
	const pickReferences = () =>
		run(async () => {
			const paths = await window.novelive.pickFiles('image')
			setReferences((current) =>
				[...new Set([...current, ...paths])].slice(0, 3),
			)
		})
	const pickLocation = () =>
		run(async () => {
			const path = await window.novelive.pickFolder()
			if (path) setFolder(path)
		})
	const start = () =>
		run(async () => {
			const result = await window.novelive.call('import.file', {
				sourcePath: source,
				folder: joining ? (joinTarget?.projectDir ?? '') : location,
				title: joining ? (joinTarget?.title ?? '') : title.trim(),
				encoding,
				references: joining ? [] : references,
				join:
					joining && joinTarget
						? {
								projectDir: joinTarget.projectDir,
								seriesId: joinTarget.seriesId,
							}
						: undefined,
			}).promise
			if (result.status === 'unsupported') {
				setError(t('扫描版 PDF 无可提取文字，暂不支持 OCR'))
				return
			}
			if (result.status === 'encoding') {
				setCandidates(result.candidates)
				setEncoding(undefined)
				return
			}
			if (result.status === 'joined') {
				setJoined(result)
				return
			}
			setWizard(result)
			setSelectedIllustrations(result.selectedIllustrations)
			setLayout(result.layout)
		})
	const finish = (revise: boolean) =>
		run(async () => {
			if (!wizard || !layout) return
			const confirm = layout.confirmWithReferences
			if (
				revise ||
				selectedIllustrations.length ||
				confirm !== wizard.layout.confirmWithReferences
			)
				await window.novelive.call('import.revise', {
					projectDir: wizard.projectDir,
					layout: revise
						? { ...layout, title: layout.title.trim() }
						: { ...wizard.layout, confirmWithReferences: confirm },
					selectedIllustrations,
				}).promise
			navigate(workRoute('work', wizard.workId))
		})

	if (joined)
		return (
			<Page
				eyebrow={t('从原文开始')}
				title={t('已加入系列')}
				width={760}
				actions={
					<button
						type="button"
						className={styles.primary}
						onClick={() => navigate(workRoute('work', joined.workId))}
					>
						{t('进入作品')}
					</button>
				}
			>
				<div className={styles.flow}>
					<section className={styles.card} aria-label={t('新增卷')}>
						{joined.volumes.map((volume) => (
							<div className={styles.fileRow} key={volume.volumeId}>
								<FileText aria-hidden="true" size={18} />
								<span className={styles.value}>{volume.title}</span>
								<span className={styles.meta}>
									{t('{{chapters}} 章', { chapters: volume.chapters })}
								</span>
							</div>
						))}
					</section>
				</div>
			</Page>
		)

	if (wizard && layout)
		return (
			<Review
				wizard={wizard}
				selectedIllustrations={selectedIllustrations}
				onSelectIllustrations={setSelectedIllustrations}
				layout={layout}
				busy={busy}
				error={error}
				onChange={setLayout}
				onFinish={finish}
			/>
		)

	const ready =
		source &&
		(joining || title.trim()) &&
		(joining ? joinTarget : location) &&
		(!candidates || encoding) &&
		!busy
	return (
		<Page eyebrow={t('从原文开始')} title={t('新建工程')} width={760}>
			<div className={styles.flow}>
				<Stepper current={0} />
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				<div className={styles.card}>
					<div className={styles.drops}>
						<button
							type="button"
							className={styles.drop}
							aria-label={t('选择原文')}
							disabled={busy}
							onClick={() => void pickSource()}
						>
							<Upload aria-hidden="true" size={22} strokeWidth={1.6} />
							<strong>{t('选择原文文件')}</strong>
							<span>{t('支持 TXT、EPUB、Markdown、DOCX、PDF')}</span>
						</button>
						<button
							type="button"
							className={styles.drop}
							aria-label={t('添加图片')}
							disabled={busy || joining || references.length >= 3}
							onClick={() => void pickReferences()}
						>
							<ImagePlus aria-hidden="true" size={22} strokeWidth={1.6} />
							<strong>{t('参考图（可选）')}</strong>
							<span>
								{joining
									? t('参考图沿用已有工程')
									: t('最多 3 张，已选 {{length}} 张', {
											length: references.length,
										})}
							</span>
						</button>
					</div>
					{(source || (!joining && references.length > 0)) && (
						<div className={styles.files}>
							{source && (
								<div className={styles.fileRow}>
									<FileText aria-hidden="true" size={18} />
									<span className={styles.value}>{fileName(source)}</span>
									<span className={styles.tag}>{t('原文')}</span>
								</div>
							)}
							{!joining &&
								references.map((path) => (
									<div key={path} className={styles.fileRow}>
										<ImagePlus aria-hidden="true" size={18} />
										<span className={styles.value}>{fileName(path)}</span>
										<span className={styles.tag}>{t('参考图')}</span>
										<button
											type="button"
											className={styles.icon}
											aria-label={t('移除 {{value}}', {
												value: fileName(path),
											})}
											onClick={() =>
												setReferences((current) =>
													current.filter((item) => item !== path),
												)
											}
										>
											<X aria-hidden="true" size={14} />
										</button>
									</div>
								))}
						</div>
					)}
					<div className={styles.grid}>
						{joining ? (
							<PickerField label={t('已有工程')}>
								<span className={styles.value}>
									{joinTarget?.projectDir ?? t('未选择')}
								</span>
								<button
									type="button"
									className={styles.button}
									disabled={busy}
									onClick={() =>
										void run(async () => {
											const projectDir = await window.novelive.pickFolder()
											if (!projectDir) return
											setJoinTarget(undefined)
											setJoinTarget(
												await window.novelive.call('import.target', {
													projectDir,
												}).promise,
											)
										})
									}
								>
									<FolderOpen aria-hidden="true" size={15} />
									{t('选择已有工程')}
								</button>
							</PickerField>
						) : (
							<PickerField label={t('工程文件夹')}>
								<span className={styles.value}>{location || t('未设置')}</span>
								<button
									type="button"
									className={styles.button}
									disabled={busy}
									onClick={() => void pickLocation()}
								>
									<FolderOpen aria-hidden="true" size={15} />
									{t('选择文件夹')}
								</button>
							</PickerField>
						)}
						<fieldset className={styles.radios}>
							<legend className={styles.label}>{t('放进哪里')}</legend>
							<label>
								<input
									type="radio"
									name="import-mode"
									checked={!joining}
									disabled={busy}
									onChange={() => setJoining(false)}
								/>
								{t('新建系列')}
							</label>
							<label>
								<input
									type="radio"
									name="import-mode"
									checked={joining}
									disabled={busy}
									onChange={() => setJoining(true)}
								/>
								{t('加入已有系列')}
							</label>
						</fieldset>
						{joining ? (
							joinTarget && (
								<Field label={t('系列')}>
									<select
										className={styles.input}
										value={joinTarget.seriesId}
										disabled={busy}
									>
										<option value={joinTarget.seriesId}>
											{joinTarget.title || joinTarget.seriesId}
										</option>
									</select>
								</Field>
							)
						) : (
							<Field label={t('作品名')}>
								<input
									className={styles.input}
									value={title}
									onChange={(event) => setTitle(event.target.value)}
								/>
							</Field>
						)}
					</div>
					{candidates && (
						<fieldset className={styles.encodings} aria-label={t('原文编码')}>
							<legend className={styles.label}>{t('原文编码')}</legend>
							{candidates.map((candidate) => (
								<label key={candidate.encoding} className={styles.option}>
									<input
										type="radio"
										name="encoding"
										checked={encoding === candidate.encoding}
										onChange={() => setEncoding(candidate.encoding)}
									/>
									<strong>{t(encodingNames[candidate.encoding])}</strong>
									<span className={styles.value}>{candidate.preview}</span>
								</label>
							))}
						</fieldset>
					)}
				</div>
				<footer className={styles.footer}>
					<span />
					<button
						type="button"
						className={styles.primary}
						disabled={!ready}
						title={source ? undefined : t('先选至少一份原文文件')}
						onClick={() => void start()}
					>
						{t('下一步')}
						<ArrowRight aria-hidden="true" size={16} />
					</button>
				</footer>
			</div>
		</Page>
	)
}

function Review({
	wizard,
	selectedIllustrations,
	onSelectIllustrations,
	layout,
	busy,
	error,
	onChange,
	onFinish,
}: {
	wizard: Wizard
	selectedIllustrations: string[]
	onSelectIllustrations(ids: string[]): void
	layout: ImportLayout
	busy: boolean
	error: string
	onChange(layout: ImportLayout): void
	onFinish(revise: boolean): void
}) {
	const total = wizard.paragraphs
	const chapterAt = (paragraph: number) =>
		layout.chapters.findLastIndex((chapter) => chapter.start <= paragraph)
	const valid =
		layout.title.trim() &&
		layout.chapters.every((chapter) => chapter.title.trim()) &&
		layout.volumes.every((volume) => volume.title.trim())
	const references = wizard.references.length + selectedIllustrations.length
	const [step, setStep] = useState(1)
	const [reviewed, setReviewed] = useState(true)
	const advance = (review: boolean) => {
		setReviewed(review)
		setStep(2)
	}
	return (
		<Page eyebrow={t('从原文开始')} title={t('新建工程')} width={760}>
			<div className={styles.flow}>
				<Stepper current={step} />
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{step === 1 && (
					<div className={styles.card}>
						<div className={styles.grid}>
							<Field label={t('作品名')}>
								<input
									className={styles.input}
									value={layout.title}
									onChange={(event) =>
										onChange({ ...layout, title: event.target.value })
									}
								/>
							</Field>
							<Field
								label={t('原文语言')}
								hint={`${
									wizard.format === 'markdown'
										? 'Markdown'
										: wizard.format.toUpperCase()
								}${
									wizard.format === 'txt' && wizard.encoding
										? ` · ${t(encodingNames[wizard.encoding])}`
										: ''
								}`}
							>
								<select
									className={styles.input}
									value={layout.language}
									onChange={(event) =>
										onChange({ ...layout, language: event.target.value })
									}
								>
									{languages.map(([value, name]) => (
										<option key={value} value={value}>
											{t(name)}
										</option>
									))}
									{!languages.some(([value]) => value === layout.language) && (
										<option value={layout.language}>{layout.language}</option>
									)}
								</select>
							</Field>
						</div>
						{wizard.findings.length > 0 && (
							<section className={styles.findings} aria-label={t('整理建议')}>
								<div className={styles.sectionHead}>
									<h2 className={styles.label}>{t('整理建议')}</h2>
									<button
										type="button"
										className={styles.ghost}
										onClick={() =>
											onChange({
												...wizard.suggested,
												title: layout.title,
												language: layout.language,
												confirmWithReferences: layout.confirmWithReferences,
											})
										}
									>
										{t('恢复建议划分')}
									</button>
								</div>
								{wizard.findings.map((finding, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: findings are a fixed list from the import report
									<div key={i} className={styles.finding}>
										<strong>
											{layout.chapters[chapterAt(finding.paragraph)]?.title}
										</strong>
										<span>{finding.note}</span>
									</div>
								))}
							</section>
						)}
						<h2 className={styles.label}>
							{t('分卷 · {{volumes}} 卷 {{chapters}} 章', {
								volumes: layout.volumes.length,
								chapters: layout.chapters.length,
							})}
						</h2>
						{layout.volumes.map((volume, v) => {
							const end = layout.volumes[v + 1]?.start ?? layout.chapters.length
							return (
								<section
									key={volume.start}
									className={styles.volume}
									aria-label={t('第 {{value}} 卷', { value: v + 1 })}
								>
									<div className={styles.volumeHead}>
										<input
											className={styles.volumeTitle}
											aria-label={t('第 {{value}} 卷标题', { value: v + 1 })}
											value={volume.title}
											onChange={(event) =>
												onChange(renameVolume(layout, v, event.target.value))
											}
										/>
										<span className={styles.meta}>
											{t('第 {{start}}–{{end}} 章', {
												start: volume.start + 1,
												end,
											})}
										</span>
										<span className={styles.spacer} />
										{v > 0 && (
											<button
												type="button"
												className={`${styles.ghost} ${styles.reveal}`}
												onClick={() => onChange(mergeVolume(layout, v))}
											>
												<Merge aria-hidden="true" size={14} />
												{t('并入上一卷')}
											</button>
										)}
									</div>
									{layout.chapters
										.slice(volume.start, end)
										.map((chapter, offset) => {
											const i = volume.start + offset
											const length = chapterLength(layout, i, total)
											return (
												<fieldset
													key={`${i}-${chapter.start}`}
													className={styles.chapter}
													aria-label={t('第 {{value}} 章', { value: i + 1 })}
												>
													<span className={styles.index}>
														{String(i + 1).padStart(2, '0')}
													</span>
													<input
														className={styles.chapterTitle}
														aria-label={t('第 {{value}} 章标题', {
															value: i + 1,
														})}
														value={chapter.title}
														onChange={(event) =>
															onChange(
																renameChapter(layout, i, event.target.value),
															)
														}
													/>
													<span className={styles.meta}>
														{t('{{length}} 段', { length })}
													</span>
													<span className={styles.reveal}>
														<button
															type="button"
															className={styles.ghost}
															disabled={length < 2}
															onClick={() =>
																onChange(splitChapter(layout, i, total))
															}
														>
															<Scissors aria-hidden="true" size={14} />
															{t('拆分')}
														</button>
														<button
															type="button"
															className={styles.ghost}
															disabled={i === 0 || isVolumeStart(layout, i)}
															onClick={() => onChange(mergeChapter(layout, i))}
														>
															<Merge aria-hidden="true" size={14} />
															{t('并入上一章')}
														</button>
														<button
															type="button"
															className={styles.ghost}
															disabled={i === 0 || isVolumeStart(layout, i)}
															onClick={() => onChange(startVolume(layout, i))}
														>
															<SplitSquareVertical
																aria-hidden="true"
																size={14}
															/>
															{t('从此分卷')}
														</button>
													</span>
												</fieldset>
											)
										})}
								</section>
							)
						})}
					</div>
				)}
				{step === 2 && (
					<div className={styles.card}>
						{wizard.illustrations.length === 0 && references === 0 && (
							<p className={styles.hint}>
								{t('这份原文没有需要额外设置的项目，可以直接开始制作。')}
							</p>
						)}
						{wizard.illustrations.length > 0 && (
							<fieldset className={styles.illustrations}>
								<legend className={styles.label}>
									{t('插图参考（最多 3 张）')}
								</legend>
								{wizard.illustrations.map((candidate, index) => {
									const checked = selectedIllustrations.includes(candidate.id)
									return (
										<label
											key={candidate.id}
											className={styles.illustration}
											data-selected={checked}
										>
											<input
												type="checkbox"
												checked={checked}
												disabled={busy || (!checked && references >= 3)}
												onChange={(event) =>
													onSelectIllustrations(
														event.target.checked
															? [...selectedIllustrations, candidate.id]
															: selectedIllustrations.filter(
																	(id) => id !== candidate.id,
																),
													)
												}
											/>
											<img
												src={candidate.preview}
												alt={t('插图 {{value}}', { value: index + 1 })}
											/>
											<span>
												{t(
													'使用插图 {{value}} · 第 {{value2}} 卷 · 第 {{value3}} 章',
													{
														value: index + 1,
														value2: candidate.volume + 1,
														value3: candidate.chapter + 1,
													},
												)}
												{candidate.paragraph === undefined
													? ''
													: t(' · 第 {{value}} 段', {
															value: candidate.paragraph + 1,
														})}
											</span>
										</label>
									)
								})}
							</fieldset>
						)}
						{references > 0 && (
							<label className={styles.toggleRow}>
								<span>
									<strong>
										{t('已有 {{value}} 张参考图时也停在角色设定', {
											value: references,
										})}
									</strong>
									<span className={styles.hint}>
										{t('关闭后直接用参考图开始制作第一章。')}
									</span>
								</span>
								<input
									type="checkbox"
									className={styles.switch}
									checked={layout.confirmWithReferences}
									onChange={(event) =>
										onChange({
											...layout,
											confirmWithReferences: event.target.checked,
										})
									}
								/>
							</label>
						)}
					</div>
				)}
				<footer className={styles.footer}>
					{step === 2 ? (
						<button
							type="button"
							className={styles.ghost}
							disabled={busy}
							onClick={() => setStep(1)}
						>
							<ArrowLeft aria-hidden="true" size={16} />
							{t('上一步')}
						</button>
					) : (
						<span />
					)}
					<span className={styles.footerActions}>
						{step === 1 ? (
							<>
								<button
									type="button"
									className={styles.ghost}
									disabled={busy}
									onClick={() => advance(false)}
								>
									{t('跳过核对')}
								</button>
								<button
									type="button"
									className={styles.primary}
									disabled={busy || !valid}
									onClick={() => advance(true)}
								>
									{t('下一步')}
									<ArrowRight aria-hidden="true" size={16} />
								</button>
							</>
						) : (
							<button
								type="button"
								className={styles.primary}
								disabled={busy}
								onClick={() => onFinish(reviewed)}
							>
								<WandSparkles aria-hidden="true" size={16} />
								{t('开始制作')}
							</button>
						)}
					</span>
				</footer>
			</div>
		</Page>
	)
}
