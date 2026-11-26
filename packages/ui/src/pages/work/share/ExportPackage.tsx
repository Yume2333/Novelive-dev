import type {
	DesktopShareApi,
	ShareRequest,
	ShareResponse,
} from '@novelive/creator/contract'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { Banner, Checkbox, RadioGroup } from '../../../components/Extended'
import { ErrorNotice } from '../../../components/Feedback'
import { ShareDialog } from '../../../components/ShareDialog'
import { type HumanizedError, humanizeError } from '../../../format/errors'
import { msg, scoped } from '../../../i18n'
import local from '../WorkPage.module.css'

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
type Level = Scope['level']

const scopes: readonly Level[] = ['work', 'volume', 'series']

const scopeLabel = {
	work: msg('单部作品'),
	volume: msg('整卷'),
	series: msg('整个系列'),
} as const

export function ExportPackage({
	api,
	pickDestination,
	projectRoot,
	volumeId,
	workId,
	workTitle,
	volumeTitle,
	seriesTitle,
	onClose,
}: {
	onClose?: () => void
	api: DesktopShareApi
	pickDestination(): Promise<string | null>
	projectRoot: string
	volumeId: string
	workId: string
	workTitle?: string
	volumeTitle?: string
	seriesTitle?: string
}) {
	const [open, setOpen] = useState(Boolean(onClose))
	const [level, setLevel] = useState<Level>('work')
	const [includeSource, setIncludeSource] = useState(false)
	const [warnings, setWarnings] = useState<Warnings>()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<HumanizedError>()
	const [versions, setVersions] = useState<number[]>()
	const scope: Scope =
		level === 'series'
			? { level }
			: level === 'volume'
				? { level, volumeId }
				: { level, volumeId, workId }
	const selection = { projectRoot, scope, includeSource }
	const scopeNames: Partial<Record<Level, string>> = {
		work: workTitle,
		volume: volumeTitle,
		series: seriesTitle,
	}

	function resetReview() {
		setWarnings(undefined)
		setError(undefined)
	}

	async function advance() {
		setBusy(true)
		setError(undefined)
		try {
			if (!warnings) {
				const response = await api.call({
					operation: 'previewExport',
					...selection,
				})
				if (response.ok) setWarnings(response.result.warnings)
				else setError(humanizeError(response.error))
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
				else setError(humanizeError(response.error))
			}
		} catch (failure) {
			const error = humanizeError(failure)
			// 未识别的异常退回导出语境的通用句，原始细节仍留在「详细信息」。
			setError(
				error.message === humanizeError(undefined).message
					? { ...error, message: t('无法导出作品包，请重试。') }
					: error,
			)
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			{!onClose && (
				<Button
					onClick={() => {
						setLevel('work')
						setIncludeSource(false)
						setVersions(undefined)
						resetReview()
						setOpen(true)
					}}
				>
					{t('导出作品包')}
				</Button>
			)}
			{open && (
				<ShareDialog
					title={t('导出作品包')}
					busy={busy}
					onClose={onClose ?? (() => setOpen(false))}
					actions={
						!versions && (
							<Button
								variant="primary"
								loading={busy}
								onClick={() => void advance()}
							>
								{warnings ? t('导出 .novelive') : t('检查导出内容')}
							</Button>
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
							<div>
								<div
									className={`label-caps label-caps-zh ${local.settingsGroup}`}
								>
									{t('导出范围')}
								</div>
								<RadioGroup
									value={level}
									disabled={busy}
									onChange={(value) => {
										setLevel(value)
										resetReview()
									}}
									options={scopes.map((value) => ({
										value,
										label: (
											<span>
												{t(scopeLabel[value])}
												{scopeNames[value] ? (
													<span aria-hidden="true">
														{' · '}
														<span className={local.exportScopeName}>
															{scopeNames[value]}
														</span>
													</span>
												) : null}
											</span>
										),
									}))}
								/>
							</div>
							<Checkbox
								checked={includeSource}
								disabled={busy}
								onChange={(checked) => {
									setIncludeSource(checked)
									resetReview()
								}}
								label={t('包含原文')}
							/>
							{warnings &&
								(warnings.length ? (
									<Banner kind="warning">
										<span>
											{t(
												'以下章节使用了占位图。导出后仍会显示占位图，可以继续导出。',
											)}
											<span className={local.exportWarnings}>
												{warnings.map((warning) => (
													<span key={`${warning.workId}/${warning.chapterId}`}>
														{warning.title}
													</span>
												))}
											</span>
										</span>
									</Banner>
								) : !busy ? (
									<p role="status">{t('检查完成，没有使用占位图的章节。')}</p>
								) : null)}
						</>
					)}
					{busy && (
						<p role="status">{warnings ? t('正在导出…') : t('正在检查…')}</p>
					)}
					{error && <ErrorNotice error={error} />}
				</ShareDialog>
			)}
		</>
	)
}
