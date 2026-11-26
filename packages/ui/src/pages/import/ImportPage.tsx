import type { CommandInput, CommandOutput } from '@novelive/creator/contract'
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	BookOpen,
	FileImage,
	FileText,
	FileType2,
	FolderOpen,
	Image,
	ImagePlus,
	type LucideIcon,
	Merge,
	Scissors,
	SplitSquareVertical,
	Upload,
	WandSparkles,
	X,
} from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Button, IconButton } from '../../components/Button'
import { Card, SectionLabel } from '../../components/Card'
import {
	Banner,
	Checkbox,
	RadioGroup,
	Stepper,
	Tooltip,
} from '../../components/Extended'
import { ErrorNotice } from '../../components/Feedback'
import { Field, Select, TextInput, Toggle } from '../../components/Form'
import { InfoTooltip } from '../../components/InfoTooltip'
import { Page } from '../../components/Page'
import {
	formatChapterLabel,
	formatChapterNumeral,
	formatChapterRange,
	formatParagraphLabel,
	formatVolumeLabel,
} from '../../format/chapter'
import { type HumanizedError, humanizeError } from '../../format/errors'
import { formatLanguage, languages } from '../../format/language'
import { formatPath, useHomeDir } from '../../format/path'
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
	nudgeVolume,
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

const encodingNames: Record<Encoding, string> = {
	'utf-8': 'UTF-8',
	gb18030: msg('GB18030（简体）'),
	big5: msg('Big5（繁体）'),
	shift_jis: msg('Shift_JIS（日文）'),
	'utf-16le': 'UTF-16 LE',
	'utf-16be': 'UTF-16 BE',
}

const steps = [msg('选择文件'), msg('核对信息'), msg('插图与参考')]

/** 向导步骤指示：共享 Stepper 负责视觉，这里补上 aria-current 步骤语义。 */
function WizardStepper({ current }: { current: number }) {
	const host = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const root = host.current?.firstElementChild
		if (!root) return
		for (const [index, item] of [...root.children].entries()) {
			if (index === current) item.setAttribute('aria-current', 'step')
			else item.removeAttribute('aria-current')
		}
	}, [current])
	return (
		<div ref={host} className={styles.stepperHost}>
			<Stepper steps={steps.map((step) => t(step))} current={current} />
		</div>
	)
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const extIcon: Record<string, LucideIcon> = {
	epub: BookOpen,
	docx: FileType2,
	pdf: FileImage,
}

/** 文件行：图标 + 文件名 + 类型标签，悬停/聚焦浮出移除按钮 */
function FileRow({
	path,
	icon: Icon,
	tag,
	onRemove,
}: {
	path: string
	icon: LucideIcon
	tag: string
	onRemove?: () => void
}) {
	return (
		<div className={`hover-row ${styles.fileRow}`}>
			<Icon
				aria-hidden="true"
				size={18}
				strokeWidth={1.8}
				className={styles.fileIcon}
			/>
			<span className={styles.fileName}>{fileName(path)}</span>
			<span className={`label-caps label-caps-zh ${styles.fileTag}`}>
				{tag}
			</span>
			{onRemove ? (
				<span className="row-actions">
					<IconButton
						icon={X}
						label={t('移除 {{value}}', { value: fileName(path) })}
						size={26}
						iconSize={13}
						onClick={onRemove}
					/>
				</span>
			) : null}
		</div>
	)
}

/** 虚线拖选区：图标 + 主标题 + 一行辅助说明 */
function DropZone({
	icon: Icon,
	title,
	caption,
	disabled,
	'aria-label': ariaLabel,
	onPick,
}: {
	icon: LucideIcon
	title: string
	caption: string
	disabled?: boolean
	'aria-label': string
	onPick: () => void
}) {
	return (
		<button
			type="button"
			className={styles.drop}
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={onPick}
		>
			<Icon aria-hidden="true" size={24} strokeWidth={1.6} />
			<strong>{title}</strong>
			<span>{caption}</span>
		</button>
	)
}

/** 只读路径选取行：玻璃输入壳 + 行尾操作按钮 */
function PickerField({
	label,
	value,
	placeholder,
	action,
}: {
	label: string
	value: string
	placeholder: string
	action: ReactNode
}) {
	const home = useHomeDir()
	const empty = value.trim() === ''
	const display = empty ? placeholder : formatPath(value, home)
	const shown = (
		<span
			className={styles.pickerValue}
			data-placeholder={empty || undefined}
			title={empty ? undefined : value}
		>
			{display}
		</span>
	)
	return (
		<div className={styles.field}>
			<span className={`label-caps label-caps-zh ${styles.fieldLabel}`}>
				{label}
			</span>
			<span className={styles.picker}>
				{shown}
				{action}
			</span>
		</div>
	)
}

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
	const [error, setError] = useState<HumanizedError>()
	const location =
		folder ?? (config && 'projectDir' in config ? config.projectDir : '')

	async function run(action: () => Promise<void>) {
		setBusy(true)
		setError(undefined)
		try {
			await action()
		} catch (failure) {
			setError(humanizeError(failure))
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
	const removeSource = () => {
		setSource('')
		setCandidates(undefined)
		setEncoding(undefined)
	}
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
	const pickJoinTarget = () =>
		run(async () => {
			const projectDir = await window.novelive.pickFolder()
			if (!projectDir) return
			setJoinTarget(undefined)
			setJoinTarget(
				await window.novelive.call('import.target', { projectDir }).promise,
			)
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
				setError({
					...humanizeError('no_extractable_text'),
					hint: t('扫描版 PDF 暂不支持识别文字，请换用带文字的文件。'),
				})
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
			if (result.status === 'error') {
				setError(humanizeError(result))
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
			) {
				const revised = await window.novelive.call('import.revise', {
					projectDir: wizard.projectDir,
					layout: revise
						? { ...layout, title: layout.title.trim() }
						: { ...wizard.layout, confirmWithReferences: confirm },
					selectedIllustrations,
				}).promise
				if (revised.status === 'error') {
					setError(humanizeError(revised))
					return
				}
			}
			navigate(workRoute('work', wizard.workId))
		})

	if (joined)
		return (
			<Page
				eyebrow={t('从原文开始')}
				title={t('已加入系列')}
				width={760}
				actions={
					<Button
						variant="primary"
						onClick={() => navigate(workRoute('work', joined.workId))}
					>
						{t('进入作品')}
					</Button>
				}
			>
				<div className={styles.flow}>
					<Card
						className={styles.cardBody}
						aria-label={t('新增卷')}
						role="region"
					>
						{joined.volumes.map((volume) => (
							<div className={styles.fileRow} key={volume.volumeId}>
								<FileText
									aria-hidden="true"
									size={18}
									strokeWidth={1.8}
									className={styles.fileIcon}
								/>
								<span className={styles.fileName}>{volume.title}</span>
								<span className={styles.meta}>
									{t('{{chapters}} 章', { chapters: volume.chapters })}
								</span>
							</div>
						))}
					</Card>
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
	const next = (
		<Button
			variant="primary"
			icon={ArrowRight}
			disabled={!ready}
			loading={busy}
			onClick={() => void start()}
		>
			{t('下一步')}
		</Button>
	)
	return (
		<Page eyebrow={t('从原文开始')} title={t('新建工程')} width={760}>
			<div className={styles.flow}>
				<WizardStepper current={0} />
				{error && <ErrorNotice error={error} />}
				<Card className={styles.cardBody}>
					<div className={styles.drops}>
						<DropZone
							icon={Upload}
							title={t('选择原文文件')}
							caption={t('支持 TXT、EPUB、Markdown、DOCX、PDF')}
							aria-label={t('选择原文')}
							disabled={busy}
							onPick={() => void pickSource()}
						/>
						<DropZone
							icon={ImagePlus}
							title={t('参考图（可选）')}
							caption={
								joining
									? t('参考图沿用已有工程')
									: t('最多 3 张，已选 {{length}} 张', {
											length: references.length,
										})
							}
							aria-label={t('添加图片')}
							disabled={busy || joining || references.length >= 3}
							onPick={() => void pickReferences()}
						/>
					</div>
					{(source || (!joining && references.length > 0)) && (
						<div className={styles.files}>
							{source && (
								<FileRow
									path={source}
									icon={
										extIcon[
											fileName(source).split('.').pop()?.toLowerCase() ?? ''
										] ?? FileText
									}
									tag={t('原文')}
									onRemove={removeSource}
								/>
							)}
							{!joining &&
								references.map((path) => (
									<FileRow
										key={path}
										path={path}
										icon={Image}
										tag={t('参考图')}
										onRemove={() =>
											setReferences((current) =>
												current.filter((item) => item !== path),
											)
										}
									/>
								))}
						</div>
					)}
					<div className={styles.grid}>
						<div className={styles.field}>
							<span className={styles.placementLabel}>
								<span
									className={`label-caps label-caps-zh ${styles.fieldLabel}`}
								>
									{t('放进哪里')}
								</span>
								<InfoTooltip
									label={t('放进哪里')}
									text={t(
										'加入已有系列时，新原文会成为下一卷并沿用原有角色、设定与素材。',
									)}
								/>
							</span>
							<RadioGroup
								value={joining ? 'existing' : 'new'}
								disabled={busy}
								onChange={(mode) => setJoining(mode === 'existing')}
								options={[
									{ value: 'new', label: t('新建系列') },
									{ value: 'existing', label: t('加入已有系列') },
								]}
							/>
						</div>
						{joining ? (
							<PickerField
								label={t('已有工程')}
								value={joinTarget?.projectDir ?? ''}
								placeholder={t('未选择')}
								action={
									<Button
										size="sm"
										icon={FolderOpen}
										disabled={busy}
										onClick={() => void pickJoinTarget()}
									>
										{t('选择已有工程')}
									</Button>
								}
							/>
						) : (
							<PickerField
								label={t('工程文件夹')}
								value={location}
								placeholder={t('未设置')}
								action={
									<Button
										size="sm"
										icon={FolderOpen}
										disabled={busy}
										onClick={() => void pickLocation()}
									>
										{t('选择文件夹')}
									</Button>
								}
							/>
						)}
						{joining ? (
							joinTarget && (
								<Field label={t('系列')}>
									<Select
										value={joinTarget.seriesId}
										disabled={busy}
										onChange={() => {}}
										options={[
											{
												value: joinTarget.seriesId,
												label: joinTarget.title.trim() || t('未命名系列'),
											},
										]}
									/>
								</Field>
							)
						) : (
							<Field label={t('作品名')}>
								<TextInput value={title} onChange={setTitle} />
							</Field>
						)}
					</div>
					{candidates && (
						<fieldset className={styles.encodings} aria-label={t('原文编码')}>
							<legend
								className={`label-caps label-caps-zh ${styles.fieldLabel}`}
							>
								{t('原文编码')}
							</legend>
							<p className={styles.encodingLead}>
								{t('自动识别失败，请选一个能正常显示原文的编码')}
							</p>
							<RadioGroup
								className={styles.encodingOptions}
								value={encoding ?? ''}
								onChange={(value) => setEncoding(value as Encoding)}
								options={candidates.map((candidate) => ({
									value: candidate.encoding,
									label: (
										<span className={styles.encodingOption}>
											<strong>{t(encodingNames[candidate.encoding])}</strong>
											<span className={styles.encodingPreview}>
												{candidate.preview}
											</span>
										</span>
									),
								}))}
							/>
						</fieldset>
					)}
				</Card>
				<footer className={styles.footer}>
					<span />
					{!source && !ready ? (
						<Tooltip text={t('先选至少一份原文文件')}>{next}</Tooltip>
					) : (
						next
					)}
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
	error: HumanizedError | undefined
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
	const languageOptions = [
		...languages.map(([value]) => ({ value, label: formatLanguage(value) })),
		...(!languages.some(([value]) => value === layout.language)
			? [{ value: layout.language, label: layout.language }]
			: []),
	]
	return (
		<Page eyebrow={t('从原文开始')} title={t('新建工程')} width={760}>
			<div className={styles.flow}>
				<WizardStepper current={step} />
				{error && <ErrorNotice error={error} />}
				{step === 1 && (
					<Card className={styles.cardBody}>
						<div className={styles.grid}>
							<Field label={t('作品名')}>
								<TextInput
									value={layout.title}
									onChange={(title) => onChange({ ...layout, title })}
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
								<Select
									value={layout.language}
									onChange={(language) => onChange({ ...layout, language })}
									options={languageOptions}
								/>
							</Field>
						</div>
						{wizard.findings.length > 0 && (
							<section className={styles.findings} aria-label={t('整理建议')}>
								<div className={styles.sectionHead}>
									<SectionLabel>{t('整理建议')}</SectionLabel>
									<Button
										variant="ghost"
										size="sm"
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
									</Button>
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
						<SectionLabel>
							{t('分卷 · {{volumes}} 卷 {{chapters}} 章', {
								volumes: layout.volumes.length,
								chapters: layout.chapters.length,
							})}
						</SectionLabel>
						{layout.volumes.map((volume, v) => {
							const end = layout.volumes[v + 1]?.start ?? layout.chapters.length
							const nextEnd =
								layout.volumes[v + 2]?.start ?? layout.chapters.length
							const canNudgeDown =
								v < layout.volumes.length - 1 &&
								layout.volumes[v + 1].start + 1 < nextEnd
							const canNudgeUp =
								v < layout.volumes.length - 1 &&
								layout.volumes[v + 1].start - 1 > volume.start
							return (
								<section
									key={volume.start}
									className={styles.volume}
									aria-label={formatVolumeLabel({ index: v + 1 })}
								>
									<div className={`hover-row ${styles.volumeHead}`}>
										<TextInput
											className={styles.volumeTitle}
											aria-label={t('第 {{value}} 卷标题', { value: v + 1 })}
											value={volume.title}
											onChange={(title) =>
												onChange(renameVolume(layout, v, title))
											}
										/>
										<span className={styles.meta}>
											{volume.start + 1 === end
												? formatChapterLabel({ index: end })
												: formatChapterRange(volume.start + 1, end)}
										</span>
										<span className={`row-actions ${styles.volumeActions}`}>
											<Tooltip text={t('往下挪一章')}>
												<IconButton
													icon={ArrowDown}
													label={t('往下挪一章')}
													size={26}
													iconSize={14}
													disabled={!canNudgeDown || busy}
													onClick={() =>
														onChange(
															nudgeVolume(layout, v, 1, layout.chapters.length),
														)
													}
												/>
											</Tooltip>
											<Tooltip text={t('往上收一章')}>
												<IconButton
													icon={ArrowUp}
													label={t('往上收一章')}
													size={26}
													iconSize={14}
													disabled={!canNudgeUp || busy}
													onClick={() =>
														onChange(
															nudgeVolume(
																layout,
																v,
																-1,
																layout.chapters.length,
															),
														)
													}
												/>
											</Tooltip>
											{v > 0 && (
												<Tooltip text={t('并入上一卷')}>
													<IconButton
														icon={Merge}
														label={t('并入上一卷')}
														size={26}
														iconSize={14}
														disabled={busy}
														onClick={() => onChange(mergeVolume(layout, v))}
													/>
												</Tooltip>
											)}
										</span>
									</div>
									{layout.chapters
										.slice(volume.start, end)
										.map((chapter, offset) => {
											const i = volume.start + offset
											const length = chapterLength(layout, i, total)
											const locked = i === 0 || isVolumeStart(layout, i)
											return (
												<fieldset
													key={`${i}-${chapter.start}`}
													className={`hover-row ${styles.chapter}`}
													aria-label={formatChapterLabel({ index: i + 1 })}
												>
													<span className={styles.index}>
														{formatChapterNumeral(i)}
													</span>
													<TextInput
														className={styles.chapterTitle}
														aria-label={t('第 {{value}} 章标题', {
															value: i + 1,
														})}
														value={chapter.title}
														onChange={(title) =>
															onChange(renameChapter(layout, i, title))
														}
													/>
													<span className={styles.meta}>
														{t('{{length}} 段', { length })}
													</span>
													<span
														className={`row-actions ${styles.chapterActions}`}
													>
														<Tooltip text={t('拆分')}>
															<IconButton
																icon={Scissors}
																label={t('拆分')}
																size={26}
																iconSize={14}
																disabled={length < 2 || busy}
																onClick={() =>
																	onChange(splitChapter(layout, i, total))
																}
															/>
														</Tooltip>
														<Tooltip text={t('并入上一章')}>
															<IconButton
																icon={Merge}
																label={t('并入上一章')}
																size={26}
																iconSize={14}
																disabled={locked || busy}
																onClick={() =>
																	onChange(mergeChapter(layout, i))
																}
															/>
														</Tooltip>
														<Tooltip text={t('从此分卷')}>
															<IconButton
																icon={SplitSquareVertical}
																label={t('从此分卷')}
																size={26}
																iconSize={14}
																disabled={locked || busy}
																onClick={() => onChange(startVolume(layout, i))}
															/>
														</Tooltip>
													</span>
												</fieldset>
											)
										})}
								</section>
							)
						})}
					</Card>
				)}
				{step === 2 && (
					<Card className={styles.cardBody}>
						{wizard.illustrations.length === 0 && references === 0 && (
							<Banner kind="info">
								{t('这份原文没有需要额外设置的项目，可以直接开始制作。')}
							</Banner>
						)}
						{wizard.illustrations.length > 0 && (
							<fieldset className={styles.illustrations}>
								<legend
									className={`label-caps label-caps-zh ${styles.fieldLabel}`}
								>
									{t('插图参考（最多 3 张）')}
								</legend>
								{wizard.illustrations.map((candidate, index) => {
									const checked = selectedIllustrations.includes(candidate.id)
									const chapter = formatChapterLabel({
										index: candidate.chapter + 1,
									})
									const coordinate = [
										formatVolumeLabel({ index: candidate.volume + 1 }),
										chapter,
										candidate.paragraph === undefined
											? ''
											: formatParagraphLabel(candidate.paragraph + 1),
									]
										.filter(Boolean)
										.join(' · ')
									const caption = (
										<span>
											{t('插图 {{value}} · {{chapter}}', {
												value: index + 1,
												chapter,
											})}
										</span>
									)
									return (
										<Checkbox
											key={candidate.id}
											className={`${styles.illustration} ${
												checked ? styles.illustrationSelected : ''
											}`}
											checked={checked}
											disabled={busy || (!checked && references >= 3)}
											onChange={(next) =>
												onSelectIllustrations(
													next
														? [...selectedIllustrations, candidate.id]
														: selectedIllustrations.filter(
																(id) => id !== candidate.id,
															),
												)
											}
											label={
												<span className={styles.illustrationBody}>
													<img
														src={candidate.preview}
														alt={t('插图 {{value}}', { value: index + 1 })}
													/>
													<Tooltip text={coordinate}>{caption}</Tooltip>
												</span>
											}
										/>
									)
								})}
							</fieldset>
						)}
						{references > 0 && (
							<div className={styles.toggleRow}>
								<span className={styles.toggleCopy}>
									<strong>
										{t('已有 {{value}} 张参考图时也停在角色设定', {
											value: references,
										})}
									</strong>
									<span className={styles.hint}>
										{t('关闭后直接用参考图开始制作第一章。')}
									</span>
								</span>
								<Toggle
									on={layout.confirmWithReferences}
									disabled={busy}
									aria-label={t('已有 {{value}} 张参考图时也停在角色设定', {
										value: references,
									})}
									onChange={(confirmWithReferences) =>
										onChange({ ...layout, confirmWithReferences })
									}
								/>
							</div>
						)}
					</Card>
				)}
				<footer className={styles.footer}>
					{step === 2 ? (
						<Button
							variant="ghost"
							icon={ArrowLeft}
							disabled={busy}
							onClick={() => setStep(1)}
						>
							{t('上一步')}
						</Button>
					) : (
						<span />
					)}
					<span className={styles.footerActions}>
						{step === 1 ? (
							<>
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() => advance(false)}
								>
									{t('跳过核对')}
								</Button>
								<Button
									variant="primary"
									icon={ArrowRight}
									disabled={busy || !valid}
									onClick={() => advance(true)}
								>
									{t('下一步')}
								</Button>
							</>
						) : (
							<Button
								variant="primary"
								icon={WandSparkles}
								loading={busy}
								disabled={busy}
								onClick={() => onFinish(reviewed)}
							>
								{t('开始制作')}
							</Button>
						)}
					</span>
				</footer>
			</div>
		</Page>
	)
}
