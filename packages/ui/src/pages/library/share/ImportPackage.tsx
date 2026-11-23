import type { DesktopShareApi, ShareResponse } from '@novelive/creator/contract'
import { useState } from 'react'
import { ShareDialog } from '../../../components/ShareDialog'
import styles from '../../../components/ShareDialog.module.css'

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
		imported !== undefined ||
		works.every((entry) => entry.relation === 'current')

	async function inspect() {
		setBusy(true)
		setError('')
		setReview(undefined)
		setImported(undefined)
		setProjectImported(false)
		try {
			const packagePath = await pickPackage()
			if (!packagePath) return
			setOpen(true)
			const response = await api.call({
				operation: 'inspectImport',
				packagePath,
			})
			if (response.ok) setReview({ packagePath, works: response.result.works })
			else setError(response.error.message)
		} catch {
			setOpen(true)
			setError('无法检查作品包，请重新选择。')
		} finally {
			setBusy(false)
		}
	}

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
				asProject ? '无法导入为工程，请重试。' : '无法导入作品包，请重试。',
			)
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<button
				type="button"
				className={styles.button}
				disabled={busy}
				onClick={() => void inspect()}
			>
				导入作品包
			</button>
			{open && (
				<ShareDialog
					title="导入作品包"
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
								{updates.length ? '确认导入与更新' : '导入'}
							</button>
						) : (
							canImportAsProject && (
								<button
									type="button"
									className={styles.primary}
									disabled={busy}
									onClick={() => void importPackage(true)}
								>
									导入为工程
								</button>
							)
						))
					}
				>
					{busy ? (
						<p role="status">{review ? '正在导入…' : '正在检查作品包…'}</p>
					) : projectImported ? (
						<p role="status">已导入为新工程，可以在书库中编辑。</p>
					) : imported !== undefined ? (
						<p role="status">已导入或更新 {imported} 部作品。</p>
					) : (
						review && (
							<>
								<ul>
									{works.map((entry) => (
										<li key={entry.work.workId}>
											<strong>《{entry.title}》</strong>{' '}
											{describeVersion(entry)}
										</li>
									))}
								</ul>
								{updates.length > 0 && (
									<div className={styles.notice}>
										<p>
											确认后将替换上述旧版本。存档和已读记录会迁移；无法迁移的存档会保留在「旧版本存档」中。
										</p>
									</div>
								)}
							</>
						)
					)}
					{review && canImportAsProject && !projectImported && (
						<p>导入为工程会创建可编辑的副本，再次导出时将使用新的作品 ID。</p>
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
			return `v${entry.work.version} · 新作品`
		case 'update':
			return `v${entry.installedVersion} → v${entry.work.version} · 可更新`
		case 'current':
			return `v${entry.work.version} · 已导入`
		case 'older':
			return `v${entry.work.version} · 已安装较新的 v${entry.installedVersion}，不会替换`
	}
}
