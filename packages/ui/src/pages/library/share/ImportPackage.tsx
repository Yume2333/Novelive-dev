import type { DesktopShareApi, ShareResponse } from '@novelive/creator/contract'
import {
	CircleCheck,
	NotebookPen,
	Package,
	TriangleAlert,
	Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { Banner } from '../../../components/Extended'
import { ErrorNotice, LoadingState } from '../../../components/Feedback'
import { Modal } from '../../../components/Modal'
import { useToast } from '../../../components/Toast'
import { type HumanizedError, humanizeError } from '../../../format/errors'
import { scoped } from '../../../i18n'
import styles from '../LibraryPage.module.css'

const t = scoped('library')

type Inspection = Extract<ShareResponse, { ok: true }>['result']
type InspectedWork = Extract<
	Inspection,
	{ operation: 'inspectImport' }
>['works'][number]

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

export function ImportPackage({
	api,
	pickPackage,
	pickProjectFolder,
	onImported,
	inspectRef,
	hideTrigger,
}: {
	api: DesktopShareApi
	pickPackage(): Promise<string | undefined>
	pickProjectFolder(): Promise<string | null>
	onImported(): void
	/** 父级（空书库的次级按钮）经此 ref 共用这个导入流程。 */
	inspectRef?: { current: (() => void) | null }
	/** 空书库时由空状态里的按钮触发，这里只留弹窗宿主。 */
	hideTrigger?: boolean
}) {
	const toast = useToast()
	const [open, setOpen] = useState(false)
	const [review, setReview] = useState<{
		packagePath: string
		works: InspectedWork[]
	}>()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<HumanizedError>()
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
			setError({ message: t('无法检查作品包，请重新选择。') })
		}
	}

	const inspectPath = useRef(async (packagePath: string) => {
		busyRef.current = true
		setBusy(true)
		setOpen(true)
		setError(undefined)
		setReview(undefined)
		setImported(undefined)
		setProjectImported(false)
		let response: ShareResponse | undefined
		try {
			response = await api.call({
				operation: 'inspectImport',
				packagePath,
			})
		} catch (failure) {
			setError(humanizeError(failure))
		} finally {
			busyRef.current = false
			setBusy(false)
		}
		if (!response) return
		if (response.ok && response.result.operation === 'inspectImport')
			setReview({ packagePath, works: response.result.works })
		else if (!response.ok) setError(humanizeError(response.error))
	}).current
	const inspectLatest = useRef(inspect)
	inspectLatest.current = inspect
	useEffect(() => {
		if (!inspectRef) return
		inspectRef.current = () => void inspectLatest.current()
		return () => {
			inspectRef.current = null
		}
	}, [inspectRef])
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
		setError(undefined)
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
					setError(humanizeError(response.error))
					return
				}
				setProjectImported(true)
				toast(t('工程副本已创建'), NotebookPen)
			} else {
				const response = await api.call({
					operation: 'import',
					packagePath,
					approvedUpdates: updates,
				})
				if (!response.ok) {
					setError(humanizeError(response.error))
					return
				}
				setImported(response.result.works.length)
				toast(t('作品包导入完成'), CircleCheck)
			}
			onImported()
		} catch (failure) {
			setError(humanizeError(failure))
		} finally {
			setBusy(false)
		}
	}

	const fileName = review?.packagePath.split(/[\\/]/).pop()
	return (
		<>
			{hideTrigger ? null : (
				<Button icon={Upload} disabled={busy} onClick={() => void inspect()}>
					{t('导入作品包')}
				</Button>
			)}
			<Modal
				open={open}
				title={t('导入作品包')}
				width={560}
				closeDisabled={busy}
				onClose={() => {
					if (!busy) setOpen(false)
				}}
				footer={
					review &&
					!projectImported &&
					(imported === undefined && canImport ? (
						<Button
							variant="primary"
							disabled={busy}
							onClick={() => void importPackage(false)}
						>
							{updates.length ? t('确认导入与更新') : t('导入')}
						</Button>
					) : (
						canImportAsProject && (
							<Button
								variant="primary"
								disabled={busy}
								onClick={() => void importPackage(true)}
							>
								{t('导入为工程')}
							</Button>
						)
					))
				}
			>
				<div className={styles.packageContent}>
					{busy ? (
						<LoadingState
							text={review ? t('正在导入…') : t('正在检查作品包…')}
						/>
					) : projectImported ? (
						<p role="status" className={styles.packageDone}>
							{t('已导入为新工程，可以在书库中编辑。')}
						</p>
					) : imported !== undefined ? (
						<p role="status" className={styles.packageDone}>
							{t('已导入或更新 {{count}} 部作品。', { count: imported })}
						</p>
					) : (
						review && (
							<>
								<div className={styles.packageHead}>
									<span className={`glass-panel ${styles.packageIcon}`}>
										<Package size={21} strokeWidth={1.8} aria-hidden="true" />
									</span>
									<div>
										<div className={styles.packageName}>{fileName}</div>
										<div className={styles.packageMeta}>
											{t('{{count}} 部作品', { count: works.length })}
										</div>
									</div>
								</div>
								{updates.length > 0 ? (
									<>
										<Banner kind="warning" icon={TriangleAlert}>
											{t('书库里已有同作品旧版本，导入后会被新版本替换。')}
										</Banner>
										<p className={styles.packageNote}>
											{t(
												'存档和已读记录会按作品内 ID 自动迁移；对不上的旧存档会保留，在存档界面单独成组。',
											)}
										</p>
									</>
								) : canImport ? (
									<Banner>{t('检查完成：是新作品，可以直接导入。')}</Banner>
								) : null}
								<ul className={styles.packageWorks}>
									{works.map((entry) => (
										<li key={entry.work.workId} className={styles.packageWork}>
											<strong className={styles.packageWorkTitle}>
												{t('《{{title}}》', { title: entry.title })}
											</strong>
											<span
												className={styles.packageWorkVersion}
												data-relation={entry.relation}
											>
												{describeVersion(entry)}
											</span>
										</li>
									))}
								</ul>
							</>
						)
					)}
					{review && canImportAsProject && !projectImported && (
						<p className={styles.packageNote}>
							{t('导入为工程会创建可编辑的副本，再次导出时将使用新的作品 ID。')}
						</p>
					)}
					{error !== undefined && <ErrorNotice error={error} />}
				</div>
			</Modal>
		</>
	)
}
