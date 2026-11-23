import { useEffect, useState } from 'react'
import type {
	LegacySaveGroup,
	SaveSlot,
} from '../../../../../../player/src/contract'
import { slotKey } from '../../../../../../player/src/progress'
import styles from './LegacySavePanel.module.css'

export interface LegacySaveActions {
	list(workId: string): Promise<readonly LegacySaveGroup[]>
	remove(workId: string, version: number, slot: SaveSlot): Promise<void>
}

export function LegacySavePanel({
	workId,
	actions,
}: {
	workId: string
	actions: LegacySaveActions
}) {
	const [groups, setGroups] = useState<readonly LegacySaveGroup[]>([])
	const [error, setError] = useState('')
	const [confirmation, setConfirmation] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		let active = true
		void actions.list(workId).then(
			(groups) => {
				if (active) setGroups(groups)
			},
			() => {
				if (active) setError('无法读取旧版本存档。')
			},
		)
		return () => {
			active = false
		}
	}, [actions, workId])

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
			setConfirmation('')
		} catch {
			setError('无法删除旧版本存档，请重试。')
		} finally {
			setBusy(false)
		}
	}

	if (!groups.length && !error) return null
	return (
		<section className={styles.panel} aria-label="旧版本存档">
			<h3>旧版本存档</h3>
			<p>这些存档无法在当前版本读取，可以保留或删除。</p>
			{error && <p role="alert">{error}</p>}
			{groups.map(({ version, saves }) => (
				<section key={version} aria-label={`版本 v${version}`}>
					<h4>版本 v{version}</h4>
					<ul>
						{saves.map(({ slot, savedAt }) => {
							const key = `${version}/${slotKey(slot)}`
							const name =
								slot.kind === 'quick' ? '快速存档' : `槽位 ${slot.slot}`
							return (
								<li className={styles.row} key={key}>
									<span>{name}</span>
									<time dateTime={savedAt}>
										{new Date(savedAt).toLocaleString()}
									</time>
									{confirmation === key ? (
										<>
											<button
												type="button"
												disabled={busy}
												onClick={() => setConfirmation('')}
											>
												取消
											</button>
											<button
												type="button"
												disabled={busy}
												onClick={() => void remove(version, slot)}
											>
												确认删除
											</button>
										</>
									) : (
										<button
											type="button"
											className={styles.delete}
											aria-label={`删除 v${version} ${name}`}
											disabled={busy}
											onClick={() => setConfirmation(key)}
										>
											删除
										</button>
									)}
								</li>
							)
						})}
					</ul>
				</section>
			))}
		</section>
	)
}
