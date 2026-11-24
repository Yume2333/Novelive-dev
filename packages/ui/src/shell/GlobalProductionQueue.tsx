import {
	type CommandOutput,
	commandError,
	productionQueueEvent,
} from '@novelive/creator/contract'
import { Workflow, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ScrollArea } from '../components/ScrollArea'
import { scoped } from '../i18n'
import { ProductionQueuePanel } from '../pages/production/queue/ProductionQueuePanel'
import styles from './GlobalProductionQueue.module.css'

const t = scoped('shell')

export function GlobalProductionQueue() {
	const [queue, setQueue] = useState<CommandOutput<'production.getQueue'>>()
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [open, setOpen] = useState(false)
	const [reload, setReload] = useState(0)
	const dialog = useRef<HTMLDialogElement>(null)
	const { pathname } = useLocation()
	useEffect(() => {
		void pathname
		dialog.current?.close()
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
						setError('')
					}
				},
				() => {
					if (active && current === revision)
						setError(t('无法读取制作队列，请重试'))
				},
			)
		}
		const offEvent = window.novelive.on('event', (event) => {
			if (event.scope !== 'app' || !productionQueueEvent.check(event.event))
				return
			revision++
			setQueue(event.event.payload)
			setError('')
		})
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			revision++
			setQueue(undefined)
			setError(t('创作端已断开，等待重新连接。'))
		})
		void window.novelive.host.appState().then((state) => {
			if (active && revision === 0 && state.creator === 'ready') load()
		})
		return () => {
			active = false
			offEvent()
			offReady()
			offDown()
		}
	}, [reload])
	async function run(action: () => Promise<unknown>) {
		setBusy(true)
		setError('')
		try {
			await action()
			setReload((value) => value + 1)
		} catch (failure) {
			if (commandError.check(failure) && failure.code === 'invalid_config') {
				setError(
					/[\u3400-\u9fff]/.test(failure.message)
						? failure.message
						: t(
								'模型配置无效，请在设置中检查接口地址、API Key、模型名和上下文长度。',
							),
				)
			} else {
				setError(t('队列操作失败，请重试'))
			}
		} finally {
			setBusy(false)
		}
	}
	const tone =
		queue?.active || queue?.queued.length
			? 'producing'
			: queue?.inactive.some(
						(work) =>
							work.status === 'awaiting_confirm' ||
							(work.status === 'paused' &&
								work.reason !== 'stopped' &&
								work.reason !== 'crashed'),
					)
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
	const waiting =
		queue?.inactive.filter((work) => work.status === 'awaiting_confirm')
			.length ?? 0
	const detail = queue?.active
		? queue.active.title
		: tone === 'confirm'
			? t('{{count}} 部作品等你确认', { count: waiting })
			: queue?.queued.length
				? t('{{count}} 部作品在排队', { count: queue.queued.length })
				: t('没有排队的作品')
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
					dialog.current?.showModal()
					setOpen(true)
				}}
			>
				<Workflow
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
			<dialog
				ref={dialog}
				className={styles.drawer}
				aria-label={t('制作队列')}
				onClose={() => setOpen(false)}
			>
				<header className={styles.header}>
					<button
						type="button"
						className={styles.close}
						aria-label={t('关闭制作队列')}
						onClick={() => dialog.current?.close()}
					>
						<X aria-hidden="true" size={18} strokeWidth={1.8} />
					</button>
				</header>
				<ScrollArea className={styles.scroll}>
					{error && <p role="alert">{error}</p>}
					{!queue && !error && <p role="status">{t('正在读取制作队列')}</p>}
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
								)
							}
							onContinue={(workId) =>
								void run(
									() =>
										window.novelive.call('production.continue', { workId })
											.promise,
								)
							}
							onStop={(workId) =>
								void run(
									() =>
										window.novelive.call('production.stop', { workId }).promise,
								)
							}
						/>
					)}
					{error && (
						<button
							type="button"
							disabled={busy}
							onClick={() => setReload((value) => value + 1)}
						>
							{t('重新读取')}
						</button>
					)}
				</ScrollArea>
			</dialog>
		</>
	)
}
