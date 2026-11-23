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

type Result = CommandOutput<'import.file'>
type Wizard = Extract<Result, { status: 'ready' }>
type Candidates = Extract<Result, { status: 'encoding' }>['candidates']
type Encoding = NonNullable<CommandInput<'import.file'>['encoding']>

const languages = [
	['zh-CN', '简体中文'],
	['zh-TW', '繁体中文'],
	['ja', '日语'],
	['en', '英语'],
	['ko', '韩语'],
] as const
const encodingNames: Record<Encoding, string> = {
	'utf-8': 'UTF-8',
	gb18030: 'GB18030（简体）',
	big5: 'Big5（繁体）',
	shift_jis: 'Shift_JIS（日文）',
	'utf-16le': 'UTF-16 LE',
	'utf-16be': 'UTF-16 BE',
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const message = (error: unknown) =>
	error && typeof error === 'object' && 'message' in error
		? String((error as CommandError).message)
		: '导入失败，请重试。'

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
				folder: location,
				title: title.trim(),
				encoding,
				references,
			}).promise
			if (result.status === 'unsupported') {
				setError('扫描版 PDF 无可提取文字，暂不支持 OCR')
				return
			}
			if (result.status === 'encoding') {
				setCandidates(result.candidates)
				setEncoding(undefined)
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
		source && title.trim() && location && (!candidates || encoding) && !busy
	return (
		<section className={styles.page}>
			<header className={styles.header}>
				<h1>导入原文</h1>
				<button
					type="button"
					className={styles.primary}
					disabled={!ready}
					onClick={() => void start()}
				>
					导入
				</button>
			</header>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			<div className={styles.card}>
				<div className={styles.row}>
					<FileText aria-hidden="true" size={18} />
					<span className={styles.label}>原文</span>
					<span className={styles.value}>
						{source ? fileName(source) : '未选择'}
					</span>
					<button
						type="button"
						disabled={busy}
						onClick={() => void pickSource()}
					>
						选择原文
					</button>
				</div>
				<label className={styles.row}>
					<span className={styles.label}>作品名</span>
					<input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</label>
				<div className={styles.row}>
					<FolderOpen aria-hidden="true" size={18} />
					<span className={styles.label}>保存位置</span>
					<span className={styles.value}>{location || '未设置'}</span>
					<button
						type="button"
						disabled={busy}
						onClick={() => void pickLocation()}
					>
						选择文件夹
					</button>
				</div>
				<div className={styles.row}>
					<ImagePlus aria-hidden="true" size={18} />
					<span className={styles.label}>参考图</span>
					<span className={styles.value}>
						{references.length ? `${references.length} 张` : '无'}
					</span>
					<button
						type="button"
						disabled={busy || references.length >= 3}
						onClick={() => void pickReferences()}
					>
						添加图片
					</button>
				</div>
				{references.map((path) => (
					<div key={path} className={`${styles.row} ${styles.sub}`}>
						<span className={styles.value}>{fileName(path)}</span>
						<button
							type="button"
							className={styles.icon}
							aria-label={`移除 ${fileName(path)}`}
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
			{candidates && (
				<fieldset className={styles.card} aria-label="原文编码">
					<legend className={styles.cardTitle}>原文编码</legend>
					{candidates.map((candidate) => (
						<label key={candidate.encoding} className={styles.row}>
							<input
								type="radio"
								name="encoding"
								checked={encoding === candidate.encoding}
								onChange={() => setEncoding(candidate.encoding)}
							/>
							<span className={styles.label}>
								{encodingNames[candidate.encoding]}
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
				<h1>核对导入</h1>
				<button type="button" disabled={busy} onClick={() => onFinish(false)}>
					跳过核对
				</button>
				<button
					type="button"
					className={styles.primary}
					disabled={busy || !valid}
					onClick={() => onFinish(true)}
				>
					确认
				</button>
			</header>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			<div className={styles.card}>
				<label className={styles.row}>
					<span className={styles.label}>作品名</span>
					<input
						value={layout.title}
						onChange={(event) =>
							onChange({ ...layout, title: event.target.value })
						}
					/>
				</label>
				<label className={styles.row}>
					<span className={styles.label}>原文语言</span>
					<select
						value={layout.language}
						onChange={(event) =>
							onChange({ ...layout, language: event.target.value })
						}
					>
						{languages.map(([value, name]) => (
							<option key={value} value={value}>
								{name}
							</option>
						))}
					</select>
					<span className={styles.value}>
						{wizard.format === 'markdown'
							? 'Markdown'
							: wizard.format.toUpperCase()}
						{wizard.format === 'txt' && wizard.encoding
							? ` · ${encodingNames[wizard.encoding]}`
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
							已有 {wizard.references.length + selectedIllustrations.length}{' '}
							张参考图时也停在角色设定
						</span>
					</label>
				)}
			</div>
			{wizard.illustrations.length > 0 && (
				<fieldset className={styles.card}>
					<legend className={styles.cardTitle}>插图参考（最多 3 张）</legend>
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
								alt={`插图 ${index + 1}`}
							/>
							<span className={styles.value}>
								使用插图 {index + 1} · 第 {candidate.volume + 1} 卷 · 第{' '}
								{candidate.chapter + 1} 章
								{candidate.paragraph === undefined
									? ''
									: ` · 第 ${candidate.paragraph + 1} 段`}
							</span>
						</label>
					))}
				</fieldset>
			)}
			{wizard.findings.length > 0 && (
				<section className={styles.card} aria-label="整理建议">
					<div className={styles.cardHeader}>
						<h2 className={styles.cardTitle}>整理建议</h2>
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
							恢复建议划分
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
						aria-label={`第 ${v + 1} 卷`}
					>
						<div className={styles.cardHeader}>
							<input
								className={styles.volumeTitle}
								aria-label={`第 ${v + 1} 卷标题`}
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
									并入上一卷
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
									aria-label={`第 ${i + 1} 章`}
								>
									<span className={styles.index}>{i + 1}</span>
									<input
										aria-label={`第 ${i + 1} 章标题`}
										value={chapter.title}
										onChange={(event) =>
											onChange(renameChapter(layout, i, event.target.value))
										}
									/>
									<span className={styles.count}>{length} 段</span>
									<span className={styles.actions}>
										<button
											type="button"
											disabled={length < 2}
											onClick={() => onChange(splitChapter(layout, i, total))}
										>
											<Scissors aria-hidden="true" size={14} />
											拆分
										</button>
										<button
											type="button"
											disabled={i === 0 || isVolumeStart(layout, i)}
											onClick={() => onChange(mergeChapter(layout, i))}
										>
											<Merge aria-hidden="true" size={14} />
											并入上一章
										</button>
										<button
											type="button"
											disabled={i === 0 || isVolumeStart(layout, i)}
											onClick={() => onChange(startVolume(layout, i))}
										>
											<SplitSquareVertical aria-hidden="true" size={14} />
											从此分卷
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
