import { ImageOff, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Drawer, EmptyState, Spinner, useToast } from '../../components'
import { scoped } from '../../i18n'
import styles from './Production.module.css'

const t = scoped('production')

/** 作品内被标记「过期」的素材（usage.list 契约，按 workId 过滤；后端不出具按章划分） */
export interface StaleAssetEntry {
	assetKey: string
	preview?: string | null
}

export function useStaleAssets(workId: string) {
	const [assets, setAssets] = useState<StaleAssetEntry[]>([])
	useEffect(() => {
		let active = true
		const request = window.novelive.call('usage.list', {})
		void request.promise.then(
			(result) => {
				if (!active) return
				setAssets(
					result.staleAssets
						.filter((asset) => asset.workId === workId)
						.map((asset) => ({ assetKey: asset.assetKey })),
				)
			},
			() => {
				if (active) setAssets([])
			},
		)
		return () => {
			active = false
			request.cancel()
		}
	}, [workId])
	const resolve = useCallback((assetKey: string) => {
		setAssets((previous) =>
			previous.filter((asset) => asset.assetKey !== assetKey),
		)
	}, [])
	return { assets, resolve }
}

function StaleAssetCard({
	workId,
	assetKey,
	onResolved,
}: {
	workId: string
	assetKey: string
	onResolved(assetKey: string): void
}) {
	const toast = useToast()
	const [preview, setPreview] = useState<string | null>(null)
	const [state, setState] = useState<'idle' | 'redrawing' | 'done' | 'failed'>(
		'idle',
	)
	const [error, setError] = useState('')
	const cancelled = useRef(false)
	useEffect(() => {
		cancelled.current = false
		return () => {
			cancelled.current = true
		}
	}, [])
	useEffect(() => {
		let active = true
		const request = window.novelive.call('production.resolveAsset', {
			workId,
			assetId: assetKey,
		})
		void request.promise.then(
			(asset) => {
				if (active && asset)
					setPreview(window.novelive.resourceUrl(asset.cachePath))
			},
			() => {},
		)
		return () => {
			active = false
			request.cancel()
		}
	}, [workId, assetKey])

	async function redraw() {
		setState('redrawing')
		setError('')
		try {
			const { revision } = await window.novelive.call('editor.imageRevision', {
				workId,
				assetId: assetKey,
			}).promise
			const result = await window.novelive.call('editor.regenerateImage', {
				workId,
				assetId: assetKey,
				expectedRevision: revision,
				count: 1,
			}).promise
			if (cancelled.current) return
			if (result.status === 'applied') {
				setState('done')
				setPreview(null)
				onResolved(assetKey)
				toast(t('「{{asset}}」重画完成', { asset: assetKey }), RotateCcw)
			} else {
				setState('failed')
				setError(t('重画返回了候选结果，请到编辑器中挑选。'))
			}
		} catch (failure) {
			if (cancelled.current) return
			setState('failed')
			setError(
				failure &&
					typeof failure === 'object' &&
					'message' in failure &&
					typeof failure.message === 'string' &&
					failure.message
					? failure.message
					: t('图片重画失败，请稍后重试。'),
			)
		}
	}

	return (
		<div className={`glass-panel ${styles.staleCard}`}>
			<div className={styles.staleRow}>
				<div className={styles.staleThumb}>
					{preview && state !== 'done' ? (
						<img className={styles.staleImage} src={preview} alt="" />
					) : null}
				</div>
				<div className={styles.staleMeta}>
					<div className={styles.staleName}>{assetKey}</div>
					<div className={styles.staleKind}>{t('上游设定或参考图已更新')}</div>
					{state === 'redrawing' ? (
						<div className={styles.staleProgress}>
							<Spinner size={13} />
							<span>{t('重绘中…')}</span>
						</div>
					) : null}
				</div>
			</div>
			{error ? <p className={styles.staleError}>{error}</p> : null}
			<div className={styles.staleActions}>
				{state === 'done' ? (
					<span className={styles.recordStatus} data-tone="done">
						{t('已重画')}
					</span>
				) : (
					<Button
						size="sm"
						icon={RotateCcw}
						loading={state === 'redrawing'}
						onClick={() => void redraw()}
					>
						{state === 'redrawing' ? t('重绘中…') : t('重画')}
					</Button>
				)}
			</div>
		</div>
	)
}

/** 过期图片抽屉：列出这部作品被标为过期的真实素材，可逐张重画（editor.regenerateImage） */
export function StaleAssetsDrawer({
	workId,
	assets,
	open,
	onClose,
	onResolved,
}: {
	workId: string
	assets: StaleAssetEntry[]
	open: boolean
	onClose(): void
	onResolved(assetKey: string): void
}) {
	return (
		<Drawer open={open} title={t('过期图片')} onClose={onClose} width={420}>
			{!assets.length ? (
				<EmptyState icon={ImageOff} text={t('暂无过期图片')} />
			) : (
				<div className={styles.staleList}>
					{assets.map((asset) => (
						<StaleAssetCard
							key={asset.assetKey}
							workId={workId}
							assetKey={asset.assetKey}
							onResolved={onResolved}
						/>
					))}
				</div>
			)}
		</Drawer>
	)
}
