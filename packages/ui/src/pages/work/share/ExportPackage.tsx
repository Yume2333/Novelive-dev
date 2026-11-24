import type {
	DesktopShareApi,
	ShareRequest,
	ShareResponse,
} from '@novelive/creator/contract'
import { useState } from 'react'
import { ShareDialog } from '../../../components/ShareDialog'
import styles from '../../../components/ShareDialog.module.css'
import { msg, scoped } from '../../../i18n'

const t = scoped('work')

type Selection = Omit<
	Extract<ShareRequest, { operation: 'previewExport' }>,
	'operation'
>
type Scope = Selection['scope']
type Warnings = Extract<
	Extract<ShareResponse, { ok: true }>['result'],
	{ operation: 'previewExport' }
>['warnings']

const scopes = [
	['work', msg('单部作品')],
	['volume', msg('整卷')],
	['series', msg('整个系列')],
] as const

export function ExportPackage({
	api,
	pickDestination,
	projectRoot,
	volumeId,
	workId,
	onClose,
}: {
	onClose?: () => void
	api: DesktopShareApi
	pickDestination(): Promise<string | null>
	projectRoot: string
	volumeId: string
	workId: string
}) {
	const [open, setOpen] = useState(Boolean(onClose))
	const [level, setLevel] = useState<Scope['level']>('work')
	const [includeSource, setIncludeSource] = useState(false)
	const [warnings, setWarnings] = useState<Warnings>()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [versions, setVersions] = useState<number[]>()
	const scope: Scope =
		level === 'series'
			? { level }
			: level === 'volume'
				? { level, volumeId }
				: { level, volumeId, workId }
	const selection = { projectRoot, scope, includeSource }

	function resetReview() {
		setWarnings(undefined)
		setError('')
	}

	async function advance() {
		setBusy(true)
		setError('')
		try {
			if (!warnings) {
				const response = await api.call({
					operation: 'previewExport',
					...selection,
				})
				if (response.ok) setWarnings(response.result.warnings)
				else setError(response.error.message)
			} else {
				const destination = await pickDestination()
				if (!destination) return
				const response = await api.call({
					operation: 'export',
					...selection,
					destination,
				})
				if (response.ok)
					setVersions(response.result.works.map((work) => work.version))
				else setError(response.error.message)
			}
		} catch {
			setError(t('无法导出作品包，请重试。'))
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			{!onClose && (
				<button
					type="button"
					className={styles.button}
					onClick={() => {
						setLevel('work')
						setIncludeSource(false)
						setVersions(undefined)
						resetReview()
						setOpen(true)
					}}
				>
					{t('导出作品包')}
				</button>
			)}
			{open && (
				<ShareDialog
					title={t('导出作品包')}
					busy={busy}
					onClose={onClose ?? (() => setOpen(false))}
					actions={
						!versions && (
							<button
								type="button"
								className={styles.primary}
								disabled={busy}
								onClick={() => void advance()}
							>
								{warnings ? t('导出 .novelive') : t('检查导出内容')}
							</button>
						)
					}
				>
					{versions ? (
						<p role="status">
							{t('已导出 {{count}} 部作品（{{versions}}）。', {
								count: versions.length,
								versions: versions
									.map((version) => `v${version}`)
									.join(t('、')),
							})}
						</p>
					) : (
						<>
							<fieldset className={styles.options} disabled={busy}>
								<legend>{t('导出范围')}</legend>
								{scopes.map(([value, label]) => (
									<label key={value}>
										<input
											type="radio"
											name="export-scope"
											checked={level === value}
											onChange={() => {
												setLevel(value)
												resetReview()
											}}
										/>
										{t(label)}
									</label>
								))}
							</fieldset>
							<label>
								<input
									type="checkbox"
									checked={includeSource}
									disabled={busy}
									onChange={(event) => {
										setIncludeSource(event.target.checked)
										resetReview()
									}}
								/>
								{t('包含原文')}
							</label>
							{warnings &&
								(warnings.length ? (
									<div className={styles.notice}>
										<p>
											{t(
												'以下章节使用了占位图。导出后仍会显示占位图，可以继续导出。',
											)}
										</p>
										<ul>
											{warnings.map(({ workId, chapterId, title }) => (
												<li key={`${workId}/${chapterId}`}>{title}</li>
											))}
										</ul>
									</div>
								) : !busy ? (
									<p role="status">{t('检查完成，没有使用占位图的章节。')}</p>
								) : null)}
						</>
					)}
					{busy && (
						<p role="status">{warnings ? t('正在导出…') : t('正在检查…')}</p>
					)}
					{error && <p role="alert">{error}</p>}
				</ShareDialog>
			)}
		</>
	)
}
