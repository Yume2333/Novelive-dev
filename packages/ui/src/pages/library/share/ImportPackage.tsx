import type { DesktopShareApi, ShareResponse } from '@novelive/creator/contract'
import { useEffect, useRef, useState } from 'react'
import { ShareDialog } from '../../../components/ShareDialog'
import styles from '../../../components/ShareDialog.module.css'
import { scoped } from '../../../i18n'
import libraryStyles from '../LibraryPage.module.css'

const t = scoped('library')

type Inspection = Extract<ShareResponse, { ok: true }>['result']
type InspectedWork = Extract<
	Inspection,
	{ operation: 'inspectImport' }
>['works'][number]

export function ImportPackage({
	api,
	pickPackage,
	pickProjectFolder,
	onImported,
}: {
	api: DesktopShareApi
	pickPackage(): Promise<string | undefined>
	pickProjectFolder(): Promise<string | null>
	onImported(): void
}) {
	const [open, setOpen] = useState(false)
	const [review, setReview] = useState<{
		packagePath: string
		works: InspectedWork[]
	}>()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [imported, setImported] = useState<number>()
	const [projectImported, setProjectImported] = useState(false)
	const busyRef = useRef(false)
	const works = review?.works ?? []
	const updates = works.flatMap((entry) =>
		entry.relation === 'update'
			? [
					{
						workId: entry.work.workId,
						installedVersion: entry.installedVersion,
						incomingVersion: entry.work.version,
					},
				]
			: [],
	)
	const canImport =
		updates.length > 0 || works.some((entry) => entry.relation === 'new')
	const canImportAsProject =
		imported !== undefined || (review !== undefined && !canImport)

	async function inspect() {
		try {
			const packagePath = await pickPackage()
			if (packagePath) await inspectPath(packagePath)
		} catch {
			setOpen(true)
			setError(t('无法检查作品包，请重新选择。'))
		}
	}

	const inspectPath = useRef(async (packagePath: string) => {
		busyRef.current = true
		setBusy(true)
		setOpen(true)
		setError('')
		setReview(undefined)
		setImported(undefined)
		setProjectImported(false)
		try {
			const response = await api.call({
				operation: 'inspectImport',
				packagePath,
			})
			if (response.ok) setReview({ packagePath, works: response.result.works })
			else setError(response.error.message)
		} catch {
			setError(t('无法检查作品包，请重新选择。'))
		} finally {
			busyRef.current = false
			setBusy(false)
		}
	}).current
	useEffect(() => {
		const installed = window.novelive?.host.installed
		if (!installed || open || busy) return
		async function take() {
			if (busyRef.current) return
			busyRef.current = true
			try {
				const path = await installed?.takeOpenFile()
				if (path) await inspectPath(path)
			} finally {
				busyRef.current = false
			}
		}
		const off = window.novelive.on('package.open', () => void take())
		void take()
		return off
	}, [busy, inspectPath, open])

	async function importPackage(asProject: boolean) {
		if (!review) return
		setBusy(true)
		setError('')
		try {
			const { packagePath } = review
			if (asProject) {
				const destination = await pickProjectFolder()
				if (!destination) return
				const response = await api.call({
					operation: 'importAsProject',
					packagePath,
					destination,
				})
				if (!response.ok) {
					setError(response.error.message)
					return
				}
				setProjectImported(true)
			} else {
				const response = await api.call({
					operation: 'import',
					packagePath,
					approvedUpdates: updates,
				})
				if (!response.ok) {
					setError(response.error.message)
					return
				}
				setImported(response.result.works.length)
			}
			onImported()
		} catch {
			setError(
				asProject
					? t('无法导入为工程，请重试。')
					: t('无法导入作品包，请重试。'),
			)
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<button
				type="button"
				className={libraryStyles.packageAction}
				disabled={busy}
				onClick={() => void inspect()}
			>
				{t('导入作品包')}
			</button>
			{open && (
				<ShareDialog
					title={t('导入作品包')}
					busy={busy}
					onClose={() => setOpen(false)}
					actions={
						review &&
						!projectImported &&
						(imported === undefined && canImport ? (
							<button
								type="button"
								className={styles.primary}
								disabled={busy}
								onClick={() => void importPackage(false)}
							>
								{updates.length ? t('确认导入与更新') : t('导入')}
							</button>
						) : (
							canImportAsProject && (
								<button
									type="button"
									className={styles.primary}
									disabled={busy}
									onClick={() => void importPackage(true)}
								>
									{t('导入为工程')}
								</button>
							)
						))
					}
				>
					{busy ? (
						<p role="status">
							{review ? t('正在导入…') : t('正在检查作品包…')}
						</p>
					) : projectImported ? (
						<p role="status">{t('已导入为新工程，可以在书库中编辑。')}</p>
					) : imported !== undefined ? (
						<p role="status">
							{t('已导入或更新 {{count}} 部作品。', { count: imported })}
						</p>
					) : (
						review && (
							<>
								<ul>
									{works.map((entry) => (
										<li key={entry.work.workId}>
											<strong>
												{t('《{{title}}》', { title: entry.title })}
											</strong>{' '}
											{describeVersion(entry)}
										</li>
									))}
								</ul>
								{updates.length > 0 && (
									<div className={styles.notice}>
										<p>
											{t(
												'确认后将替换上述旧版本。存档和已读记录会迁移；无法迁移的存档会保留在「旧版本存档」中。',
											)}
										</p>
									</div>
								)}
							</>
						)
					)}
					{review && canImportAsProject && !projectImported && (
						<p>
							{t('导入为工程会创建可编辑的副本，再次导出时将使用新的作品 ID。')}
						</p>
					)}
					{error && <p role="alert">{error}</p>}
				</ShareDialog>
			)}
		</>
	)
}

function describeVersion(entry: InspectedWork) {
	switch (entry.relation) {
		case 'new':
			return t('v{{version}} · 新作品', { version: entry.work.version })
		case 'update':
			return t('v{{installed}} → v{{version}} · 可更新', {
				installed: entry.installedVersion,
				version: entry.work.version,
			})
		case 'current':
			return t('v{{version}} · 已导入', { version: entry.work.version })
		case 'older':
			return t('v{{version}} · 已安装较新的 v{{installed}}，不会替换', {
				version: entry.work.version,
				installed: entry.installedVersion,
			})
	}
}
