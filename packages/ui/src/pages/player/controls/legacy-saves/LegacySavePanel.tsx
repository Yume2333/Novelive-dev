import { useEffect, useState } from 'react'
import type {
	LegacySaveGroup,
	SaveEntry,
	SaveSlot,
} from '../../../../../../player/src/contract'
import { slotKey } from '../../../../../../player/src/progress'
import { Button } from '../../../../components/Button'
import { ConfirmDialog } from '../../../../components/Extended'
import { ErrorNotice } from '../../../../components/Feedback'
import { formatChapterLabel } from '../../../../format/chapter'
import { scoped } from '../../../../i18n'
import styles from './LegacySavePanel.module.css'

const t = scoped('player')

export interface LegacySaveActions {
	list(workId: string): Promise<readonly LegacySaveGroup[]>
	remove(workId: string, version: number, slot: SaveSlot): Promise<void>
}

interface DeleteTarget {
	version: number
	slot: SaveSlot
}

export function LegacySavePanel({
	workId,
	chapters = [],
	actions,
}: {
	workId: string
	chapters?: readonly { chapterId: string; title: string }[]
	actions: LegacySaveActions
}) {
	const [groups, setGroups] = useState<readonly LegacySaveGroup[]>([])
	const [error, setError] = useState('')
	const [target, setTarget] = useState<DeleteTarget | null>(null)
	const [confirmAll, setConfirmAll] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		let active = true
		void actions.list(workId).then(
			(groups) => {
				if (active) setGroups(groups)
			},
			() => {
				if (active) setError(t('无法读取旧版本的存档，请重试。'))
			},
		)
		return () => {
			active = false
		}
	}, [actions, workId])

	const chapterLabelFor = (chapterId: string) => {
		const order = chapters.findIndex(
			(chapter) => chapter.chapterId === chapterId,
		)
		return order === -1
			? t('未知章节')
			: formatChapterLabel({
					index: order + 1,
					title: chapters[order].title,
				})
	}

	const entryMeta = (entry: SaveEntry) => {
		const chapter = chapterLabelFor(entry.snapshot.position.chapterId)
		const line = entry.snapshot.stage.text.content
			.map((part) => (part.type === 'text' ? part.text : ''))
			.join('')
		return line ? `${chapter} · ${line}` : chapter
	}

	async function remove(version: number, slot: SaveSlot) {
		setBusy(true)
		setError('')
		try {
			await actions.remove(workId, version, slot)
			setGroups((groups) =>
				groups
					.map((group) =>
						group.version === version
							? {
									...group,
									saves: group.saves.filter(
										(entry) => slotKey(entry.slot) !== slotKey(slot),
									),
								}
							: group,
					)
					.filter((group) => group.saves.length > 0),
			)
		} catch {
			setError(t('无法删除旧版本存档，请重试。'))
		} finally {
			setBusy(false)
			setTarget(null)
		}
	}

	async function removeAll() {
		setBusy(true)
		setError('')
		let failed = false
		const remaining: LegacySaveGroup[] = []
		for (const group of groups) {
			const left: SaveEntry[] = []
			for (const entry of group.saves) {
				if (failed) {
					left.push(entry)
					continue
				}
				try {
					await actions.remove(workId, group.version, entry.slot)
				} catch {
					failed = true
					left.push(entry)
				}
			}
			if (left.length) remaining.push({ ...group, saves: left })
		}
		setGroups(remaining)
		if (failed) setError(t('无法删除旧版本存档，请重试。'))
		setBusy(false)
		setConfirmAll(false)
	}

	if (!groups.length && !error) return null
	return (
		<section className={styles.panel} aria-label={t('旧版本存档')}>
			<h3>{t('旧版本存档')}</h3>
			<p className={styles.explanation}>
				{t(
					'这部作品已更新到新版本，这些存档无法在新版本中读取。删除它们不影响当前的阅读进度。',
				)}
			</p>
			{error && <ErrorNotice message={error} />}
			{groups.map(({ version, saves }) => (
				<section
					key={version}
					aria-label={t('旧版本的存档（版本 {{version}}）', { version })}
				>
					<h4>{t('旧版本的存档（版本 {{version}}）', { version })}</h4>
					<ul>
						{saves.map((entry) => {
							const { slot, savedAt } = entry
							const key = `${version}/${slotKey(slot)}`
							const name =
								slot.kind === 'quick'
									? t('快速存档')
									: t('存档 {{index}}', { index: slot.slot })
							return (
								<li className={`hover-row ${styles.row}`} key={key}>
									<span className={styles.rowText}>
										<span className={styles.rowTitle}>{name}</span>
										<span className={styles.rowMeta}>{entryMeta(entry)}</span>
									</span>
									<time dateTime={savedAt}>
										{new Date(savedAt).toLocaleString()}
									</time>
									<span className="row-actions">
										<Button
											size="sm"
											variant="ghost"
											aria-label={t('删除版本 {{version}} 的{{name}}', {
												version,
												name,
											})}
											disabled={busy}
											onClick={() => setTarget({ version, slot })}
										>
											{t('删除')}
										</Button>
									</span>
								</li>
							)
						})}
					</ul>
				</section>
			))}
			{groups.length > 0 && (
				<div className={styles.bulkRow}>
					<Button
						variant="ghost"
						disabled={busy}
						onClick={() => setConfirmAll(true)}
					>
						{t('全部删除')}
					</Button>
				</div>
			)}
			<ConfirmDialog
				open={target !== null}
				title={t('删除这个存档？')}
				message={t('删除后无法恢复。删除旧版本的存档不影响当前的阅读进度。')}
				confirmLabel={t('删除')}
				danger
				busy={busy}
				onConfirm={() => {
					if (target) void remove(target.version, target.slot)
				}}
				onCancel={() => setTarget(null)}
			/>
			<ConfirmDialog
				open={confirmAll}
				title={t('全部删除')}
				message={t(
					'确定要删除全部旧版本的存档吗？删除后无法恢复，但不影响当前的阅读进度。',
				)}
				confirmLabel={t('全部删除')}
				danger
				busy={busy}
				onConfirm={() => void removeAll()}
				onCancel={() => setConfirmAll(false)}
			/>
		</section>
	)
}
