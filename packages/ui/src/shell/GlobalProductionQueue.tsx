import {
	type CommandOutput,
	commandError,
	type ProductionSnapshot,
	productionQueueEvent,
	productionSnapshotEvent,
} from '@novelive/creator/contract'
import {
	ArrowUpDown,
	CircleStop,
	Clapperboard,
	ListChecks,
	Moon,
	Play,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
	ConfirmDialog,
	Drawer,
	ErrorNotice,
	LoadingState,
	useToast,
} from '../components'
import { type HumanizedError, humanizeError } from '../format/errors'
import { scoped } from '../i18n'
import { ProductionQueuePanel } from '../pages/production/queue/ProductionQueuePanel'
import styles from './GlobalProductionQueue.module.css'

const t = scoped('shell')

const toneIcon = {
	producing: Clapperboard,
	confirm: ListChecks,
	stopped: CircleStop,
	idle: Moon,
} as const

export function GlobalProductionQueue() {
	const [queue, setQueue] = useState<CommandOutput<'production.getQueue'>>()
	const [loadError, setLoadError] = useState<HumanizedError>()
	const [opError, setOpError] = useState<HumanizedError>()
	const [busy, setBusy] = useState(false)
	const [open, setOpen] = useState(false)
	const [reload, setReload] = useState(0)
	const [pendingStop, setPendingStop] = useState<string | null>(null)
	const [activeSnapshot, setActiveSnapshot] = useState<ProductionSnapshot>()
	const toast = useToast()
	const { pathname } = useLocation()
	useEffect(() => {
		void pathname
		setOpen(false)
		setPendingStop(null)
	}, [pathname])
	useEffect(() => {
		void reload
		let active = true
		let revision = 0
		const load = () => {
			const current = ++revision
			void window.novelive.call('production.getQueue', {}).promise.then(
				(next) => {
					if (active && current === revision) {
						setQueue(next)
						setLoadError(undefined)
						setOpError(undefined)
					}
				},
				(failure) => {
					if (active && current === revision)
						setLoadError(humanizeError(failure))
				},
			)
		}
		const offEvent = window.novelive.on('event', (event) => {
			if (event.scope !== 'app' || !productionQueueEvent.check(event.event))
				return
			revision++
			setQueue(event.event.payload)
			setLoadError(undefined)
			setOpError(undefined)
		})
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			revision++
			setQueue(undefined)
			setLoadError(humanizeError('creator_down'))
		})
		// An explicit reload (drawer open, 重新读取, creator.ready) must always
		// fetch when the creator is ready: events emitted before an external
		// change can otherwise suppress the fetch with a stale payload.
		void window.novelive.host.appState().then((state) => {
			if (active && state.creator === 'ready') load()
		})
		return () => {
			active = false
			offEvent()
			offReady()
			offDown()
		}
	}, [reload])
	const activeWorkId = queue?.active?.link.workId
	useEffect(() => {
		if (!activeWorkId) {
			setActiveSnapshot(undefined)
			return
		}
		let active = true
		let revision = 0
		let pending:
			| { promise: Promise<ProductionSnapshot>; cancel(): void }
			| undefined
		const load = () => {
			const current = ++revision
			pending?.cancel()
			pending = window.novelive.call('production.get', { workId: activeWorkId })
			void pending.promise.then(
				(next) => {
					if (active && current === revision) setActiveSnapshot(next)
				},
				() => {},
			)
		}
		const offEvent = window.novelive.on('event', (event) => {
			if (
				event.scope !== 'work' ||
				event.scopeId !== activeWorkId ||
				!productionSnapshotEvent.check(event.event)
			)
				return
			revision++
			setActiveSnapshot(event.event.payload)
		})
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			revision++
			setActiveSnapshot(undefined)
		})
		load()
		return () => {
			active = false
			pending?.cancel()
			offEvent()
			offReady()
			offDown()
		}
	}, [activeWorkId])
	async function run(
		action: () => Promise<unknown>,
		toastText?: string,
		toastIcon?: typeof ArrowUpDown,
	): Promise<boolean> {
		setBusy(true)
		setOpError(undefined)
		try {
			await action()
			setReload((value) => value + 1)
			if (toastText) toast(toastText, toastIcon)
			return true
		} catch (failure) {
			// invalid_config 的中文消息是后端针对具体场景的引导文案（如「请先继续制作前卷：…」），
			// 直接透传；英文细节统一替换为面向创作者的检查指引，原始文本不外泄。
			if (commandError.check(failure) && failure.code === 'invalid_config') {
				setOpError({
					message: /[\u3400-\u9fff]/.test(failure.message)
						? failure.message
						: t(
								'模型配置无效，请在设置中检查接口地址、API Key、模型名和上下文长度。',
							),
				})
			} else {
				setOpError(humanizeError(failure))
			}
			return false
		} finally {
			setBusy(false)
		}
	}
	const waiting =
		queue?.inactive.filter(
			(work) =>
				work.status === 'awaiting_confirm' ||
				(work.status === 'paused' &&
					work.reason !== 'stopped' &&
					work.reason !== 'crashed'),
		).length ?? 0
	const tone =
		queue?.active || queue?.queued.length
			? 'producing'
			: waiting
				? 'confirm'
				: queue?.inactive.some((work) => work.status === 'paused')
					? 'stopped'
					: 'idle'
	const status = {
		producing: t('制作中'),
		confirm: t('待确认'),
		stopped: t('已停止'),
		idle: t('空闲'),
	}[tone]
	const StatusIcon = toneIcon[tone]
	const detail = (() => {
		if (queue?.active) {
			if (
				activeSnapshot &&
				activeSnapshot.workId === queue.active.link.workId
			) {
				const producingIndex = activeSnapshot.chapters.findIndex(
					(c) => c.status === 'producing',
				)
				if (producingIndex >= 0)
					return t('{{title}} · 第 {{index}} 章', {
						title: queue.active.title,
						index: producingIndex + 1,
					})
				if (activeSnapshot.phase === 'preview')
					return t('{{title}} · 全书预览', { title: queue.active.title })
			}
			return queue.active.title
		}
		if (tone === 'confirm')
			return t('{{count}} 部作品等你确认', { count: waiting })
		if (queue?.queued.length)
			return t('{{count}} 部作品在排队', { count: queue.queued.length })
		if (tone === 'stopped') {
			const pausedCount =
				queue?.inactive.filter((work) => work.status === 'paused').length ?? 0
			return t('{{count}} 部作品已暂停', { count: pausedCount })
		}
		return t('没有排队的作品')
	})()
	const pendingStopTitle = pendingStop
		? (queue?.active?.link.workId === pendingStop && queue.active.title) ||
			queue?.queued.find((work) => work.link.workId === pendingStop)?.title ||
			queue?.inactive.find((work) => work.link.workId === pendingStop)?.title
		: undefined
	return (
		<>
			<button
				type="button"
				className={`glass-panel ${styles.status}`}
				data-tone={tone}
				aria-label={t('全局制作状态：{{status}}', { status })}
				aria-expanded={open}
				onClick={() => {
					setReload((value) => value + 1)
					setOpen(true)
				}}
			>
				<StatusIcon
					aria-hidden="true"
					size={18}
					strokeWidth={1.8}
					className={styles.statusIcon}
				/>
				<span className={styles.statusText}>
					<span className={styles.statusLabel}>{status}</span>
					<span className={styles.statusDetail}>{detail}</span>
				</span>
				{tone !== 'confirm' && waiting > 0 && (
					<span className={styles.badge} title={t('待确认')}>
						{waiting}
					</span>
				)}
			</button>
			<Drawer
				open={open}
				title={t('制作队列')}
				onClose={() => {
					if (!pendingStop) setOpen(false)
				}}
				width={432}
			>
				<div className={styles.drawerBody}>
					{loadError !== undefined && (
						<ErrorNotice
							error={loadError}
							onRetry={() => setReload((value) => value + 1)}
							retryLabel={t('重新读取')}
						/>
					)}
					{opError !== undefined && <ErrorNotice error={opError} />}
					{!queue && loadError === undefined && (
						<LoadingState text={t('正在读取制作队列')} />
					)}
					{queue && (
						<ProductionQueuePanel
							queue={queue}
							busy={busy}
							onMove={(workId, direction) =>
								void run(
									() =>
										window.novelive.call('production.moveQueueWork', {
											workId,
											direction,
										}).promise,
									t('已调整队列顺序'),
									ArrowUpDown,
								)
							}
							onContinue={(workId) =>
								void run(
									() =>
										window.novelive.call('production.continue', { workId })
											.promise,
									t('已继续制作'),
									Play,
								)
							}
							onStop={(workId) => setPendingStop(workId)}
						/>
					)}
				</div>
			</Drawer>
			<ConfirmDialog
				open={Boolean(pendingStop)}
				title={t('停止制作')}
				message={t(
					'将停止制作《{{title}}》。正在进行的请求会中断，下次继续时重做被中断的部分。',
					{ title: pendingStopTitle ?? '' },
				)}
				confirmLabel={t('立即停止')}
				danger
				busy={busy}
				onCancel={() => setPendingStop(null)}
				onConfirm={() => {
					if (!pendingStop) return
					const workId = pendingStop
					void run(
						() => window.novelive.call('production.stop', { workId }).promise,
						t('已停止制作'),
						CircleStop,
					).then(() => setPendingStop(null))
				}}
			/>
		</>
	)
}
