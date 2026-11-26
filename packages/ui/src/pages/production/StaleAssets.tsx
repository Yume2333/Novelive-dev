import type { CommandOutput } from '@novelive/creator/contract'
import { parseScript } from '@novelive/format/script'
import { ImageOff, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	Button,
	ButtonLink,
	Drawer,
	EmptyState,
	ErrorNotice,
	Spinner,
	useToast,
} from '../../components'
import {
	type AssetLabelInfo,
	assetLabelInfoFromBible,
	formatAssetLabel,
} from '../../format/asset'
import { type HumanizedError, humanizeError } from '../../format/errors'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { useWorkProduction } from '../work/WorkProduction'
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

type BibleOutput = CommandOutput<'bible.get'>

/** 资产键的展示信息：bible 里的角色／场景名字与描述；bible 读不到时逐段人性化 */
function useAssetLabelInfo(
	workId: string,
	volumeId: string | undefined,
	open: boolean,
): AssetLabelInfo | undefined {
	const [info, setInfo] = useState<AssetLabelInfo>()
	useEffect(() => {
		if (!open || !volumeId) return
		let active = true
		const request = window.novelive.call('bible.get', { workId, volumeId })
		void request.promise.then(
			(bible: BibleOutput) => {
				if (active) setInfo(assetLabelInfoFromBible(bible))
			},
			() => {},
		)
		return () => {
			active = false
			request.cancel()
		}
	}, [workId, volumeId, open])
	return info
}

/** 一个过期资产的使用面：引用它的场景总数、章总数、以及「去编辑器」要跳到的第一章 */
export interface AssetUsage {
	sceneCount: number
	chapterCount: number
	firstChapterId?: string
}

/**
 * 逐章解析已发布章的已编译剧本，统计资产键被哪些章的多少场景引用。
 * 单章读取失败时跳过该章，不影响其余章的统计。
 */
function useStaleAssetUsage(
	workId: string,
	assets: StaleAssetEntry[],
	open: boolean,
): Map<string, AssetUsage> {
	const { snapshot: workSnapshot } = useWorkProduction()
	const [usage, setUsage] = useState<Map<string, AssetUsage>>(new Map())
	const signature = workSnapshot.chapters
		.filter((chapter) => chapter.status === 'published')
		.map((chapter) => chapter.chapterId)
		.join(',')
	useEffect(() => {
		if (!open || !assets.length) {
			setUsage(new Map())
			return
		}
		let active = true
		const keys = new Set(assets.map((asset) => asset.assetKey))
		async function scan() {
			const found = new Map<
				string,
				{ scenes: number; chapters: number; firstChapterId?: string }
			>()
			for (const chapterId of signature ? signature.split(',') : []) {
				let script: string
				try {
					;({ script } = await window.novelive.call(
						'production.playerChapter',
						{ workId, chapterId },
					).promise)
				} catch {
					continue
				}
				if (!active) return
				const perScene = new Map<string, number>()
				for (const scene of parseScript(script).scenes) {
					const seen = new Set<string>()
					for (const line of scene.lines) {
						if (line.type !== 'action') continue
						const asset = line.args.asset
						if (
							typeof asset !== 'string' ||
							!keys.has(asset) ||
							seen.has(asset)
						)
							continue
						seen.add(asset)
						perScene.set(asset, (perScene.get(asset) ?? 0) + 1)
					}
				}
				for (const [key, count] of perScene) {
					const entry = found.get(key) ?? {
						scenes: 0,
						chapters: 0,
						firstChapterId: chapterId,
					}
					entry.scenes += count
					entry.chapters += 1
					found.set(key, entry)
				}
			}
			if (!active) return
			const next = new Map<string, AssetUsage>()
			for (const key of keys) {
				const entry = found.get(key)
				next.set(key, {
					sceneCount: entry?.scenes ?? 0,
					chapterCount: entry?.chapters ?? 0,
					...(entry?.firstChapterId
						? { firstChapterId: entry.firstChapterId }
						: {}),
				})
			}
			setUsage(next)
		}
		void scan()
		return () => {
			active = false
		}
	}, [workId, open, assets, signature])
	return usage
}

function StaleAssetCard({
	workId,
	assetKey,
	labelInfo,
	usage,
	onResolved,
}: {
	workId: string
	assetKey: string
	labelInfo?: AssetLabelInfo
	usage?: AssetUsage
	onResolved(assetKey: string): void
}) {
	const { snapshot } = useWorkProduction()
	const toast = useToast()
	const [preview, setPreview] = useState<string | null>(null)
	const [thumbFailed, setThumbFailed] = useState(false)
	const [state, setState] = useState<'idle' | 'redrawing' | 'done' | 'failed'>(
		'idle',
	)
	const [error, setError] = useState<HumanizedError | undefined>()
	const [candidates, setCandidates] = useState(false)
	const cancelled = useRef(false)
	useEffect(() => {
		cancelled.current = false
		return () => {
			cancelled.current = true
		}
	}, [])
	useEffect(() => {
		setThumbFailed(false)
		let active = true
		const request = window.novelive.call('production.resolveAsset', {
			workId,
			assetId: assetKey,
		})
		void request.promise.then(
			(asset) => {
				if (!active) return
				if (asset) setPreview(window.novelive.resourceUrl(asset.cachePath))
				else setThumbFailed(true)
			},
			() => {
				if (active) setThumbFailed(true)
			},
		)
		return () => {
			active = false
			request.cancel()
		}
	}, [workId, assetKey])

	const label = formatAssetLabel(assetKey, labelInfo)

	async function redraw() {
		setState('redrawing')
		setError(undefined)
		setCandidates(false)
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
				toast(t('「{{asset}}」重画完成', { asset: label }), RotateCcw)
			} else {
				setState('failed')
				setCandidates(true)
			}
		} catch (failure) {
			if (cancelled.current) return
			setState('failed')
			setError(humanizeError(failure))
		}
	}

	const editorChapterId =
		usage?.firstChapterId ??
		snapshot.chapters.find((chapter) => chapter.status === 'published')
			?.chapterId ??
		snapshot.chapters[0]?.chapterId
	const cascadeChapter =
		usage && usage.chapterCount === 1 && usage.firstChapterId
			? snapshot.chapters.findIndex(
					(chapter) => chapter.chapterId === usage.firstChapterId,
				) + 1
			: 0
	const cascade =
		usage && usage.chapterCount > 0 && usage.sceneCount > 0
			? usage.chapterCount === 1 && cascadeChapter > 0
				? t('重画后第 {{chapter}} 章的 {{scenes}} 个场景会一起换新图', {
						chapter: cascadeChapter,
						scenes: usage.sceneCount,
					})
				: t('重画后 {{chapters}} 章的 {{scenes}} 个场景会一起换新图', {
						chapters: usage.chapterCount,
						scenes: usage.sceneCount,
					})
			: ''

	return (
		<div className={`glass-panel ${styles.staleCard}`}>
			<div className={styles.staleRow}>
				<div className={styles.staleThumb} data-failed={thumbFailed}>
					{preview && state !== 'done' ? (
						<img
							className={styles.staleImage}
							src={preview}
							alt=""
							onError={() => setThumbFailed(true)}
						/>
					) : null}
				</div>
				<div className={styles.staleMeta}>
					<div className={styles.staleName}>{label}</div>
					<div className={styles.staleKind}>{t('上游设定或参考图已更新')}</div>
					{usage && usage.sceneCount > 0 ? (
						<div className={styles.staleUsage}>
							{t('用于 {{scenes}} 个场景', { scenes: usage.sceneCount })}
						</div>
					) : null}
					{state === 'redrawing' ? (
						<div className={styles.staleProgress}>
							<Spinner size={13} />
							<span>{t('重绘中…')}</span>
						</div>
					) : null}
				</div>
			</div>
			{candidates ? (
				<p className={styles.staleCandidates}>
					{t('重画返回了候选结果。')}
					{editorChapterId ? (
						<>
							{' '}
							<ButtonLink
								variant="ghost"
								size="sm"
								to={`${workRoute('editor', workId)}?chapterId=${encodeURIComponent(editorChapterId)}`}
							>
								{t('到编辑器中挑选')}
							</ButtonLink>
						</>
					) : null}
				</p>
			) : error ? (
				<ErrorNotice className={styles.staleNotice} error={error} />
			) : null}
			<div className={styles.staleActions}>
				{state === 'done' ? (
					<span className={styles.recordStatus} data-tone="done">
						{t('已重画')}
					</span>
				) : (
					<>
						<Button
							size="sm"
							icon={RotateCcw}
							loading={state === 'redrawing'}
							onClick={() => void redraw()}
						>
							{state === 'redrawing' ? t('重绘中…') : t('重画')}
						</Button>
						{cascade ? (
							<span className={styles.staleCascade}>{cascade}</span>
						) : null}
					</>
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
	const { snapshot, project } = useWorkProduction()
	const volumeId = project?.volumeId ?? snapshot.exportTarget?.volumeId
	const labelInfo = useAssetLabelInfo(workId, volumeId, open)
	const usage = useStaleAssetUsage(workId, assets, open)
	return (
		<Drawer open={open} title={t('过期图片')} onClose={onClose} width={420}>
			{!assets.length ? (
				<EmptyState
					icon={ImageOff}
					title={t('暂无过期图片')}
					text={t('上游设定或参考图更新后，受影响的图片会出现在这里。')}
				/>
			) : (
				<div className={styles.staleList}>
					{assets.map((asset) => (
						<StaleAssetCard
							key={asset.assetKey}
							workId={workId}
							assetKey={asset.assetKey}
							labelInfo={labelInfo}
							usage={usage.get(asset.assetKey)}
							onResolved={onResolved}
						/>
					))}
				</div>
			)}
		</Drawer>
	)
}
