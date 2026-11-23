import type {
	CommandError,
	CommandInput,
	CommandOutput,
} from '@novelive/creator/contract'
import {
	FileText,
	FolderOpen,
	ImagePlus,
	Merge,
	Scissors,
	SplitSquareVertical,
	X,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
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
			if (revise || selectedIllustrations.length)
				await window.novelive.call('import.revise', {
					projectDir: wizard.projectDir,
					layout: revise
						? { ...layout, title: layout.title.trim() }
						: wizard.layout,
					selectedIllustrations,
				}).promise
			navigate(workRoute('work', wizard.workId))
		})

	if (joined)
		return (
			<section className={styles.page}>
				<header className={styles.header}>
					<h1>{t('已加入系列')}</h1>
					<button
						type="button"
						className={styles.primary}
						onClick={() => navigate(workRoute('work', joined.workId))}
					>
						{t('进入作品')}
					</button>
				</header>
				<section className={styles.card} aria-label={t('新增卷')}>
					{joined.volumes.map((volume) => (
						<div className={styles.row} key={volume.volumeId}>
							<span className={styles.value}>{volume.title}</span>
							<span>{t('{{chapters}} 章', { chapters: volume.chapters })}</span>
						</div>
					))}
				</section>
			</section>
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
		<section className={styles.page}>
			<header className={styles.header}>
				<h1>{t('导入原文')}</h1>
				<button
					type="button"
					className={styles.primary}
					disabled={!ready}
					onClick={() => void start()}
				>
					{t('导入')}
				</button>
			</header>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			<div className={styles.card}>
				<fieldset className={styles.card}>
					<legend className={styles.cardTitle}>{t('导入方式')}</legend>
					<label className={styles.row}>
						<input
							type="radio"
							name="import-mode"
							checked={!joining}
							disabled={busy}
							onChange={() => setJoining(false)}
						/>
						<span>{t('新建工程')}</span>
					</label>
					<label className={styles.row}>
						<input
							type="radio"
							name="import-mode"
							checked={joining}
							disabled={busy}
							onChange={() => setJoining(true)}
						/>
						<span>{t('加入已有系列')}</span>
					</label>
				</fieldset>
				<div className={styles.row}>
					<FileText aria-hidden="true" size={18} />
					<span className={styles.label}>{t('原文')}</span>
					<span className={styles.value}>
						{source ? fileName(source) : t('未选择')}
					</span>
					<button
						type="button"
						disabled={busy}
						onClick={() => void pickSource()}
					>
						{t('选择原文')}
					</button>
				</div>
				{!joining && (
					<label className={styles.row}>
						<span className={styles.label}>{t('作品名')}</span>
						<input
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
				)}
				{joining ? (
					<>
						<div className={styles.row}>
							<FolderOpen aria-hidden="true" size={18} />
							<span className={styles.label}>{t('已有工程')}</span>
							<span className={styles.value}>
								{joinTarget?.projectDir ?? t('未选择')}
							</span>
							<button
								type="button"
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
								{t('选择已有工程')}
							</button>
						</div>
						{joinTarget && (
							<label className={styles.row}>
								<span className={styles.label}>{t('系列')}</span>
								<select value={joinTarget.seriesId} disabled={busy}>
									<option value={joinTarget.seriesId}>
										{joinTarget.title || joinTarget.seriesId}
									</option>
								</select>
							</label>
						)}
						<div className={styles.row}>
							<span className={styles.label}>{t('参考图')}</span>
							<span className={styles.value}>{t('沿用已有工程')}</span>
						</div>
					</>
				) : (
					<>
						<div className={styles.row}>
							<FolderOpen aria-hidden="true" size={18} />
							<span className={styles.label}>{t('保存位置')}</span>
							<span className={styles.value}>{location || t('未设置')}</span>
							<button
								type="button"
								disabled={busy}
								onClick={() => void pickLocation()}
							>
								{t('选择文件夹')}
							</button>
						</div>
						<div className={styles.row}>
							<ImagePlus aria-hidden="true" size={18} />
							<span className={styles.label}>{t('参考图')}</span>
							<span className={styles.value}>
								{references.length
									? t('{{length}} 张', { length: references.length })
									: t('无')}
							</span>
							<button
								type="button"
								disabled={busy || references.length >= 3}
								onClick={() => void pickReferences()}
							>
								{t('添加图片')}
							</button>
						</div>
						{references.map((path) => (
							<div key={path} className={`${styles.row} ${styles.sub}`}>
								<span className={styles.value}>{fileName(path)}</span>
								<button
									type="button"
									className={styles.icon}
									aria-label={t('移除 {{value}}', { value: fileName(path) })}
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
					</>
				)}
			</div>
			{candidates && (
				<fieldset className={styles.card} aria-label={t('原文编码')}>
					<legend className={styles.cardTitle}>{t('原文编码')}</legend>
					{candidates.map((candidate) => (
						<label key={candidate.encoding} className={styles.row}>
							<input
								type="radio"
								name="encoding"
								checked={encoding === candidate.encoding}
								onChange={() => setEncoding(candidate.encoding)}
							/>
							<span className={styles.label}>
								{t(encodingNames[candidate.encoding])}
							</span>
							<span className={styles.value}>{candidate.preview}</span>
						</label>
					))}
				</fieldset>
			)}
		</section>
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
	return (
		<section className={styles.page}>
			<header className={styles.header}>
				<h1>{t('核对导入')}</h1>
				<button type="button" disabled={busy} onClick={() => onFinish(false)}>
					{t('跳过核对')}
				</button>
				<button
					type="button"
					className={styles.primary}
					disabled={busy || !valid}
					onClick={() => onFinish(true)}
				>
					{t('确认')}
				</button>
			</header>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			<div className={styles.card}>
				<label className={styles.row}>
					<span className={styles.label}>{t('作品名')}</span>
					<input
						value={layout.title}
						onChange={(event) =>
							onChange({ ...layout, title: event.target.value })
						}
					/>
				</label>
				<label className={styles.row}>
					<span className={styles.label}>{t('原文语言')}</span>
					<select
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
					<span className={styles.value}>
						{wizard.format === 'markdown'
							? 'Markdown'
							: wizard.format.toUpperCase()}
						{wizard.format === 'txt' && wizard.encoding
							? ` · ${t(encodingNames[wizard.encoding])}`
							: ''}
					</span>
				</label>
				{wizard.references.length + selectedIllustrations.length > 0 && (
					<label className={styles.row}>
						<input
							type="checkbox"
							checked={layout.confirmWithReferences}
							onChange={(event) =>
								onChange({
									...layout,
									confirmWithReferences: event.target.checked,
								})
							}
						/>
						<span className={styles.value}>
							{t('已有 {{value}} 张参考图时也停在角色设定', {
								value: wizard.references.length + selectedIllustrations.length,
							})}
						</span>
					</label>
				)}
			</div>
			{wizard.illustrations.length > 0 && (
				<fieldset className={styles.card}>
					<legend className={styles.cardTitle}>
						{t('插图参考（最多 3 张）')}
					</legend>
					{wizard.illustrations.map((candidate, index) => (
						<label key={candidate.id} className={styles.row}>
							<input
								type="checkbox"
								checked={selectedIllustrations.includes(candidate.id)}
								disabled={
									busy ||
									(!selectedIllustrations.includes(candidate.id) &&
										wizard.references.length + selectedIllustrations.length >=
											3)
								}
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
								className={styles.illustration}
								src={candidate.preview}
								alt={t('插图 {{value}}', { value: index + 1 })}
							/>
							<span className={styles.value}>
								{t('使用插图 {{value}} · 第 {{value2}} 卷 · 第 {{value3}} 章', {
									value: index + 1,
									value2: candidate.volume + 1,
									value3: candidate.chapter + 1,
								})}
								{candidate.paragraph === undefined
									? ''
									: t(' · 第 {{value}} 段', { value: candidate.paragraph + 1 })}
							</span>
						</label>
					))}
				</fieldset>
			)}
			{wizard.findings.length > 0 && (
				<section className={styles.card} aria-label={t('整理建议')}>
					<div className={styles.cardHeader}>
						<h2 className={styles.cardTitle}>{t('整理建议')}</h2>
						<button
							type="button"
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
						<div key={i} className={`${styles.row} ${styles.finding}`}>
							<span className={styles.label}>
								{layout.chapters[chapterAt(finding.paragraph)]?.title}
							</span>
							<span className={styles.value}>{finding.note}</span>
						</div>
					))}
				</section>
			)}
			{layout.volumes.map((volume, v) => {
				const end = layout.volumes[v + 1]?.start ?? layout.chapters.length
				return (
					<section
						key={volume.start}
						className={styles.card}
						aria-label={t('第 {{value}} 卷', { value: v + 1 })}
					>
						<div className={styles.cardHeader}>
							<input
								className={styles.volumeTitle}
								aria-label={t('第 {{value}} 卷标题', { value: v + 1 })}
								value={volume.title}
								onChange={(event) =>
									onChange(renameVolume(layout, v, event.target.value))
								}
							/>
							{v > 0 && (
								<button
									type="button"
									onClick={() => onChange(mergeVolume(layout, v))}
								>
									<Merge aria-hidden="true" size={14} />
									{t('并入上一卷')}
								</button>
							)}
						</div>
						{layout.chapters.slice(volume.start, end).map((chapter, offset) => {
							const i = volume.start + offset
							const length = chapterLength(layout, i, total)
							return (
								<fieldset
									key={`${i}-${chapter.start}`}
									className={styles.row}
									aria-label={t('第 {{value}} 章', { value: i + 1 })}
								>
									<span className={styles.index}>{i + 1}</span>
									<input
										aria-label={t('第 {{value}} 章标题', { value: i + 1 })}
										value={chapter.title}
										onChange={(event) =>
											onChange(renameChapter(layout, i, event.target.value))
										}
									/>
									<span className={styles.count}>
										{t('{{length}} 段', { length })}
									</span>
									<span className={styles.actions}>
										<button
											type="button"
											disabled={length < 2}
											onClick={() => onChange(splitChapter(layout, i, total))}
										>
											<Scissors aria-hidden="true" size={14} />
											{t('拆分')}
										</button>
										<button
											type="button"
											disabled={i === 0 || isVolumeStart(layout, i)}
											onClick={() => onChange(mergeChapter(layout, i))}
										>
											<Merge aria-hidden="true" size={14} />
											{t('并入上一章')}
										</button>
										<button
											type="button"
											disabled={i === 0 || isVolumeStart(layout, i)}
											onClick={() => onChange(startVolume(layout, i))}
										>
											<SplitSquareVertical aria-hidden="true" size={14} />
											{t('从此分卷')}
										</button>
									</span>
								</fieldset>
							)
						})}
					</section>
				)
			})}
		</section>
	)
}
