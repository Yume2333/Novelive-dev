import { useEffect, useState } from 'react'
import type {
	PlaybackHistory,
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

export function ProgressPanel({
	view,
	workId,
	progress,
	history,
	legacySaves,
	onSlot,
	onHistory,
	onHistoryStep,
}: ProgressControlsProps & {
	view: 'save' | 'load' | 'history'
	onSlot(slot: SaveSlot): void
}) {
	const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
	const [failure, setFailure] = useState('')
	const occurrences = new Map<string, number>()
	const historyEntries = history.entries.map((snapshot) => {
		const position = JSON.stringify(snapshot.position)
		const occurrence = (occurrences.get(position) ?? 0) + 1
		occurrences.set(position, occurrence)
		return { snapshot, key: `${position}-${occurrence}` }
	})
	useEffect(() => {
		if (view === 'history') return
		let cancelled = false
		setFailure('')
		void Promise.all(
			progress.saves
				.filter((entry) => entry.slot.kind === 'manual')
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
					historyEntries.map(({ snapshot, key }, index) => (
						<button
							type="button"
							key={key}
							aria-current={index === history.cursor ? 'step' : undefined}
							onClick={() => onHistory(index)}
						>
							{index + 1}.{' '}
							{snapshot.stage.text.content
								.map((part) => (part.type === 'text' ? part.text : ''))
								.join('')}
						</button>
					))
				) : (
					<p>{t('暂无历史记录')}</p>
				)}
			</>
		)
	return (
		<>
			{failure && <p role="alert">{failure}</p>}
			{legacySaves && (
				<LegacySavePanel key={workId} workId={workId} actions={legacySaves} />
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
								<span className="nl-save-empty">{t('空槽位')}</span>
							)}
							<span>{t('槽位 {{value}}', { value: index + 1 })}</span>
							{entry && (
								<time dateTime={entry.savedAt}>
									{new Date(entry.savedAt).toLocaleString()}
								</time>
							)}
						</button>
					)
				})}
			</div>
		</>
	)
}
