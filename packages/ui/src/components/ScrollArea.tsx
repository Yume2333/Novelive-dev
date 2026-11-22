import {
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react'
import styles from './ScrollArea.module.css'

/**
 * 悬浮自定义滚动条（配合 .nl-scroll-hidden 隐藏原生滚轮控件）：
 * - 零占位，不裁切圆角，静默时隐去，悬停 / 滚动 / 拖拽时柔和浮现
 * - 支持直接挂在 <textarea> 外层容器上，或通过 <ScrollArea> 复用
 */
export function OverlayScrollbar({
	targetRef,
	insetTop = 4,
	insetBottom = 4,
	insetRight = 3,
}: {
	targetRef: RefObject<HTMLElement | null>
	insetTop?: number
	insetBottom?: number
	insetRight?: number
}) {
	const trackRef = useRef<HTMLDivElement>(null)
	const [geom, setGeom] = useState<{
		visible: boolean
		height: number
		top: number
	}>({
		visible: false,
		height: 0,
		top: 0,
	})
	const [scrolling, setScrolling] = useState(false)
	const [dragging, setDragging] = useState(false)
	const hideTimer = useRef<number | null>(null)
	const dragRef = useRef<{
		startY: number
		startTop: number
		maxScroll: number
		maxTrack: number
	} | null>(null)
	const rafRef = useRef<number | null>(null)

	const measure = useCallback(() => {
		const el = targetRef.current
		if (!el) return
		const { scrollHeight, clientHeight, scrollTop } = el
		const overflow = scrollHeight - clientHeight
		if (overflow <= 1 || clientHeight <= 0) {
			setGeom((prev) =>
				prev.visible ? { visible: false, height: 0, top: 0 } : prev,
			)
			return
		}
		const trackH =
			trackRef.current?.clientHeight ??
			Math.max(0, clientHeight - insetTop - insetBottom)
		if (trackH <= 0) return
		const ratio = clientHeight / scrollHeight
		const thumbH = Math.max(24, Math.min(trackH, Math.round(trackH * ratio)))
		const maxTrack = Math.max(0, trackH - thumbH)
		const top = maxTrack > 0 ? Math.round((scrollTop / overflow) * maxTrack) : 0
		setGeom((prev) =>
			prev.visible && prev.height === thumbH && prev.top === top
				? prev
				: { visible: true, height: thumbH, top },
		)
	}, [targetRef, insetTop, insetBottom])

	const scheduleMeasure = useCallback(() => {
		if (rafRef.current !== null) return
		rafRef.current = window.requestAnimationFrame(() => {
			rafRef.current = null
			measure()
		})
	}, [measure])

	useEffect(() => {
		const el = targetRef.current
		if (!el) return
		measure()

		const onScroll = () => {
			measure()
			setScrolling(true)
			if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
			hideTimer.current = window.setTimeout(() => setScrolling(false), 750)
		}

		el.addEventListener('scroll', onScroll, { passive: true })
		el.addEventListener('input', scheduleMeasure, { passive: true })

		const ro = new ResizeObserver(scheduleMeasure)
		ro.observe(el)
		if (el.firstElementChild) ro.observe(el.firstElementChild)

		const mo = new MutationObserver(scheduleMeasure)
		mo.observe(el, { childList: true, subtree: true, characterData: true })

		return () => {
			el.removeEventListener('scroll', onScroll)
			el.removeEventListener('input', scheduleMeasure)
			ro.disconnect()
			mo.disconnect()
			if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
			if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
			rafRef.current = null
		}
	}, [targetRef, measure, scheduleMeasure])

	const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault()
		e.stopPropagation()
		const el = targetRef.current
		const track = trackRef.current
		if (!el || !track) return
		const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight)
		const maxTrack = Math.max(1, track.clientHeight - geom.height)
		dragRef.current = {
			startY: e.clientY,
			startTop: el.scrollTop,
			maxScroll,
			maxTrack,
		}
		setDragging(true)
		e.currentTarget.setPointerCapture(e.pointerId)
	}

	const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current
		const el = targetRef.current
		if (!drag || !el) return
		const dy = e.clientY - drag.startY
		el.scrollTop = drag.startTop + (dy / drag.maxTrack) * drag.maxScroll
	}

	const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!dragRef.current) return
		dragRef.current = null
		setDragging(false)
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId)
		}
	}

	const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.target !== trackRef.current) return
		const el = targetRef.current
		const track = trackRef.current
		if (!el || !track) return
		const rect = track.getBoundingClientRect()
		const clickY = e.clientY - rect.top - geom.height / 2
		const maxTrack = Math.max(1, rect.height - geom.height)
		const ratio = Math.max(0, Math.min(1, clickY / maxTrack))
		el.scrollTo({
			top: ratio * (el.scrollHeight - el.clientHeight),
			behavior: 'smooth',
		})
	}

	if (!geom.visible) return null

	return (
		<div
			ref={trackRef}
			aria-hidden="true"
			className={styles.track}
			data-active={scrolling || dragging ? 'true' : 'false'}
			data-dragging={dragging ? 'true' : 'false'}
			onPointerDown={onTrackPointerDown}
			style={{
				top: insetTop,
				bottom: insetBottom,
				right: insetRight,
			}}
		>
			<div
				className={styles.thumb}
				onPointerDown={onThumbPointerDown}
				onPointerMove={onThumbPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				style={{
					height: geom.height,
					transform: `translateY(${geom.top}px)`,
				}}
			/>
		</div>
	)
}

/**
 * 全项目统一滚动容器：隐藏操作系统默认滚动条，渲染纤细悬浮自定义滑块。
 */
export function ScrollArea({
	children,
	style,
	viewportStyle,
	className,
	viewportRef,
	insetTop = 4,
	insetBottom = 4,
	insetRight = 3,
}: {
	children: ReactNode
	style?: CSSProperties
	viewportStyle?: CSSProperties
	className?: string
	viewportRef?: RefObject<HTMLDivElement | null>
	insetTop?: number
	insetBottom?: number
	insetRight?: number
}) {
	const internalRef = useRef<HTMLDivElement>(null)
	const activeRef = viewportRef ?? internalRef
	return (
		<div
			className={className ? `${styles.host} ${className}` : styles.host}
			style={style}
		>
			<div
				ref={activeRef}
				className={styles.viewport}
				data-scroll-viewport=""
				style={viewportStyle}
			>
				{children}
			</div>
			<OverlayScrollbar
				targetRef={activeRef}
				insetTop={insetTop}
				insetBottom={insetBottom}
				insetRight={insetRight}
			/>
		</div>
	)
}
