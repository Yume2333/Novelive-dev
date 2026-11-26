import { BookmarkPlus, ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
	PlaybackHistory,
	SaveEntry,
	SaveSlot,
	WorkProgress,
} from '../../../../../player/src/contract'
import { manualSaveSlots } from '../../../../../player/src/contract'
import { slotKey } from '../../../../../player/src/progress'
import { scoped } from '../../../i18n'
import {
	type LegacySaveActions,
	LegacySavePanel,
} from './legacy-saves/LegacySavePanel'

const t = scoped('player')
const slotsPerPage = 6
const pageCount = Math.ceil(manualSaveSlots / slotsPerPage)

export interface ProgressControlsProps {
	workId: string
	progress: WorkProgress
	history: PlaybackHistory
	legacySaves?: LegacySaveActions
	onSave(slot: SaveSlot): Promise<void>
	onLoad(slot: SaveSlot): Promise<void>
	onHistory(index: number): void
	onHistoryStep(direction: 'back' | 'forward'): void
}

interface HistoryChapter {
	chapterId: string
	title: string
}

export function ProgressPanel({
	view,
	workId,
	progress,
	history,
	chapters = [],
	legacySaves,
	onSlot,
	onHistory,
	onHistoryStep,
}: ProgressControlsProps & {
	view: 'save' | 'load' | 'history'
	chapters?: readonly HistoryChapter[]
	onSlot(slot: SaveSlot): void
}) {
	const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
	const [failure, setFailure] = useState('')
	const [page, setPage] = useState(0)
	const occurrences = new Map<string, number>()
	const historyEntries = history.entries.map((snapshot) => {
		const position = JSON.stringify(snapshot.position)
		const occurrence = (occurrences.get(position) ?? 0) + 1
		occurrences.set(position, occurrence)
		return { snapshot, key: `${position}-${occurrence}` }
	})
	const historyGroups: {
		chapterId: string
		rows: ((typeof historyEntries)[number] & { index: number })[]
	}[] = []
	historyEntries.forEach((entry, index) => {
		const chapterId = entry.snapshot.position.chapterId
		const last = historyGroups.at(-1)
		if (last?.chapterId === chapterId) last.rows.push({ ...entry, index })
		else historyGroups.push({ chapterId, rows: [{ ...entry, index }] })
	})
	const chapterLabel = (chapterId: string) => {
		const order = chapters.findIndex(
			(chapter) => chapter.chapterId === chapterId,
		)
		return order === -1
			? chapterId
			: t('第 {{index}} 章 · {{title}}', {
					index: order + 1,
					title: chapters[order].title,
				})
	}
	useEffect(() => {
		if (view === 'history') return
		let cancelled = false
		setFailure('')
		void Promise.all(
			progress.saves
				.filter(
					(entry) =>
						entry.slot.kind === 'quick' || entry.slot.kind === 'manual',
				)
				.map(async (entry) => {
					const image = await window.novelive.host.progress?.thumbnail(
						workId,
						entry.slot,
					)
					return [slotKey(entry.slot), image ?? ''] as const
				}),
		)
			.then((images) => {
				if (!cancelled) setThumbnails(Object.fromEntries(images))
			})
			.catch(() => {
				if (!cancelled) setFailure(t('无法加载存档缩略图'))
			})
		return () => {
			cancelled = true
		}
	}, [view, workId, progress.saves])
	if (view === 'history')
		return (
			<>
				<div className="nl-history-navigation">
					<button
						type="button"
						disabled={!history.cursor}
						onClick={() => onHistoryStep('back')}
					>
						{t('后退一句')}
					</button>
					<button
						type="button"
						disabled={
							history.cursor === null ||
							history.cursor >= history.entries.length - 1
						}
						onClick={() => onHistoryStep('forward')}
					>
						{t('前进一句')}
					</button>
				</div>
				{history.entries.length ? (
					<div className="nl-history-groups">
						{historyGroups.map(({ chapterId, rows }) => (
							<section
								key={rows[0].key}
								className="nl-history-list"
								aria-label={chapterLabel(chapterId)}
							>
								<h3 className="nl-history-chapter">
									{chapterLabel(chapterId)}
								</h3>
								{rows.map(({ snapshot, key, index }) => (
									<button
										type="button"
										key={key}
										className="nl-history-row"
										aria-current={index === history.cursor ? 'step' : undefined}
										onClick={() => onHistory(index)}
									>
										{snapshot.stage.text.displayName && (
											<span className="nl-history-speaker" aria-hidden="true">
												{snapshot.stage.text.displayName}
											</span>
										)}
										<span className="nl-history-text">
											<span className="nl-history-index">{index + 1}.</span>{' '}
											{snapshot.stage.text.content
												.map((part) => (part.type === 'text' ? part.text : ''))
												.join('')}
										</span>
									</button>
								))}
							</section>
						))}
					</div>
				) : (
					<p>{t('暂无历史记录')}</p>
				)}
			</>
		)
	const slotMeta = (entry: SaveEntry) => {
		const order = chapters.findIndex(
			(chapter) => chapter.chapterId === entry.snapshot.position.chapterId,
		)
		const chapter =
			order === -1
				? entry.snapshot.position.chapterId
				: t('第 {{index}} 章 · {{title}}', {
						index: order + 1,
						title: chapters[order].title,
					})
		const line = entry.snapshot.stage.text.content
			.map((part) => (part.type === 'text' ? part.text : ''))
			.join('')
		return line ? `${chapter} · ${line}` : chapter
	}
	const quickSlot: SaveSlot = { kind: 'quick' }
	const quickEntry = progress.saves.find((entry) => entry.slot.kind === 'quick')
	return (
		<>
			{failure && <p role="alert">{failure}</p>}
			{legacySaves && (
				<LegacySavePanel key={workId} workId={workId} actions={legacySaves} />
			)}
			{page === 0 && (
				<div className="nl-quicksave-strip">
					<button
						type="button"
						className="nl-focus-skip"
						aria-label={view === 'save' ? t('快速存档') : t('快速读档')}
						disabled={view === 'load' && !quickEntry}
						onClick={() => onSlot(quickSlot)}
					>
						{thumbnails[slotKey(quickSlot)] ? (
							<img
								src={thumbnails[slotKey(quickSlot)]}
								width={480}
								height={270}
								alt={t('快速存档缩略图')}
							/>
						) : (
							<span className="nl-save-empty">
								<BookmarkPlus size={22} strokeWidth={1.8} aria-hidden="true" />
							</span>
						)}
						<span className="nl-quicksave-badge">
							<BookmarkPlus size={12} strokeWidth={1.8} aria-hidden="true" />
							{t('快速')}
						</span>
						<span className="nl-save-title">
							{quickEntry
								? slotMeta(quickEntry)
								: view === 'save'
									? t('快速存档')
									: t('暂无快速存档')}
						</span>
						{quickEntry ? (
							<time dateTime={quickEntry.savedAt}>
								{new Date(quickEntry.savedAt).toLocaleString()}
							</time>
						) : (
							<span className="nl-save-meta">—</span>
						)}
					</button>
				</div>
			)}
			<div className="nl-save-grid">
				{Array.from({ length: manualSaveSlots }, (_, index) => {
					const slot: SaveSlot = { kind: 'manual', slot: index + 1 }
					const name = slotKey(slot)
					const entry = progress.saves.find(
						(entry) => slotKey(entry.slot) === name,
					)
					return (
						<button
							type="button"
							key={name}
							hidden={Math.floor(index / slotsPerPage) !== page}
							aria-label={
								view === 'save'
									? t('存档槽位 {{index}}', { index: index + 1 })
									: t('读档槽位 {{index}}', { index: index + 1 })
							}
							disabled={view === 'load' && !entry}
							onClick={() => onSlot(slot)}
						>
							{thumbnails[name] ? (
								<img
									src={thumbnails[name]}
									width={480}
									height={270}
									alt={t('槽位 {{value}} 缩略图', { value: index + 1 })}
								/>
							) : (
								<span className="nl-save-empty">
									<Save size={22} strokeWidth={1.8} aria-hidden="true" />
								</span>
							)}
							<span className="nl-save-title">
								{entry
									? t('槽位 {{value}}', { value: index + 1 })
									: t('空存档位')}
							</span>
							{entry && (
								<span className="nl-save-excerpt">{slotMeta(entry)}</span>
							)}
							{entry ? (
								<time dateTime={entry.savedAt}>
									{new Date(entry.savedAt).toLocaleString()}
								</time>
							) : (
								<span className="nl-save-meta">—</span>
							)}
						</button>
					)
				})}
			</div>
			<nav className="nl-save-pages" aria-label={t('存档分页')}>
				<button
					type="button"
					className="nl-save-page-step nl-focus-skip"
					aria-label={t('上一页')}
					disabled={page === 0}
					onClick={() => setPage(page - 1)}
				>
					<ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>
				{Array.from({ length: pageCount }, (_, value) => (
					<button
						type="button"
						// biome-ignore lint/suspicious/noArrayIndexKey: pages are fixed positions
						key={value}
						className="nl-save-page nl-focus-skip"
						aria-current={value === page ? 'page' : undefined}
						onClick={() => setPage(value)}
					>
						{value + 1}
					</button>
				))}
				<button
					type="button"
					className="nl-save-page-step nl-focus-skip"
					aria-label={t('下一页')}
					disabled={page === pageCount - 1}
					onClick={() => setPage(page + 1)}
				>
					<ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>
			</nav>
		</>
	)
}
