import type { WorkSettings } from '@novelive/format/model'
import type { Inline } from '@novelive/format/script'
import { markDeclarations } from './custom-marks'
import { textTiming } from './timing'
import './text.css'

export interface TextOptions {
	customMarks?: WorkSettings['customMarks']
	millisecondsPerCharacter?: number
	auto?: boolean
	continueImmediately?: boolean
	autoSpeedMultiplier?: number
	skip?: boolean
}

export function mountText(
	host: HTMLElement,
	content: readonly Inline[],
	options: TextOptions = {},
) {
	const layout = document.createElement('div')
	layout.className = 'nl-text-layout'
	layout.setAttribute('aria-hidden', 'true')
	const glyphs: HTMLElement[] = []
	const { delays, trailingPause } = textTiming(
		content,
		options.millisecondsPerCharacter ?? 30,
	)
	const styles = new Map<string, ReturnType<typeof markDeclarations>>()
	const stack: { element: HTMLElement; perChar?: string }[] = [
		{ element: layout },
	]
	let pause = trailingPause
	let trailingPending = trailingPause > 0
	for (const part of content) {
		const current = stack[stack.length - 1].element
		if (part.type === 'pause') continue
		if (part.type === 'open') {
			const element = document.createElement(
				part.name === 'ruby' ? 'ruby' : 'span',
			)
			element.dataset.mark = part.name
			element.className = `nl-text-mark-${part.name}`
			if (part.name === 'ruby') element.dataset.reading = part.argument ?? ''
			const marks = options.customMarks
			const mark =
				marks && Object.hasOwn(marks, part.name) ? marks[part.name] : undefined
			if (mark && !styles.has(part.name))
				styles.set(part.name, markDeclarations(part.name, mark.css))
			const styled = !!styles.get(part.name)?.length
			if (styled && !mark?.perChar) element.dataset.markStyle = part.name
			current.append(element)
			stack.push({
				element,
				perChar: styled && mark?.perChar ? part.name : undefined,
			})
		} else if (part.type === 'close') {
			if (current.tagName === 'RUBY') {
				const rt = document.createElement('rt')
				rt.textContent = current.dataset.reading ?? ''
				current.append(rt)
			}
			stack.pop()
		} else {
			for (const { segment } of new Intl.Segmenter(undefined, {
				granularity: 'grapheme',
			}).segment(part.text)) {
				const glyph = document.createElement('span')
				glyph.dataset.glyph = String(glyphs.length)
				let target = glyph
				for (const { perChar } of stack) {
					if (!perChar) continue
					const effect = document.createElement('span')
					effect.className = 'nl-text-mark-char'
					effect.dataset.markStyle = perChar
					target.append(effect)
					target = effect
				}
				target.textContent = segment
				current.append(glyph)
				glyphs.push(glyph)
			}
		}
	}
	const display = layout.cloneNode(true) as HTMLElement
	display.className = 'nl-text-display'
	display.removeAttribute('aria-hidden')
	for (const layer of [layout, display]) {
		for (const element of layer.querySelectorAll<HTMLElement>(
			'[data-mark-style]',
		)) {
			for (const [property, value, priority] of styles.get(
				element.dataset.markStyle ?? '',
			) ?? []) {
				if (priority || !element.style.getPropertyPriority(property))
					element.style.setProperty(property, value, priority)
			}
			if (element.style.transform)
				element.classList.add('nl-text-mark-transform')
		}
	}
	const visible = Array.from(
		display.querySelectorAll<HTMLElement>('[data-glyph]'),
	)
	const window = document.createElement('div')
	window.className = 'nl-text-window'
	window.append(display)
	host.classList.add('nl-text-viewport')
	host.append(layout, window)
	let ends: number[] = []
	let offsets: number[] = []
	let heights: number[] = []
	let page = 0
	let revealed = 0
	let disposed = false
	let awaitingClick = false
	let timer: ReturnType<typeof setTimeout> | undefined
	let resolveDone: () => void = () => {}
	const finished = new Promise<void>((resolve) => {
		resolveDone = resolve
	})
	function paint() {
		visible.forEach((glyph, index) => {
			glyph.style.visibility = index < revealed ? 'visible' : 'hidden'
		})
		for (const ruby of display.querySelectorAll('ruby')) {
			const rt = ruby.querySelector('rt')
			if (rt)
				rt.style.visibility = Array.from(
					ruby.querySelectorAll<HTMLElement>('[data-glyph]'),
				).some((glyph) => Number(glyph.dataset.glyph) < revealed)
					? 'visible'
					: 'hidden'
		}
		display.style.transform = `translateY(${-offsets[page]}px)`
		window.style.height = `${heights[page]}px`
		host.dataset.page = String(page + 1)
		host.dataset.pages = String(ends.length)
		host.dataset.revealed = String(revealed)
	}
	function schedule() {
		clearTimeout(timer)
		if (disposed) return
		if (options.skip) {
			revealed = glyphs.length
			paint()
			resolveDone()
			return
		}
		while (revealed < ends[page] && delays[revealed] === 0) revealed++
		paint()
		if (awaitingClick) return
		if (revealed < ends[page]) {
			timer = setTimeout(
				() => {
					revealed++
					schedule()
				},
				options.skip ? 0 : delays[revealed],
			)
		} else if (page === ends.length - 1 && trailingPending && !options.skip) {
			const delay = pause
			timer = setTimeout(() => {
				trailingPending = false
				schedule()
			}, delay)
		} else if (page === ends.length - 1 && options.continueImmediately) {
			if (!awaitingClick) resolveDone()
		} else if (options.auto || options.skip) {
			const count = ends[page] - (ends[page - 1] ?? 0)
			timer = setTimeout(
				() => {
					if (page + 1 < ends.length) {
						page++
						schedule()
					} else resolveDone()
				},
				options.skip
					? 0
					: (1200 + 80 * count) / (options.autoSpeedMultiplier ?? 1),
			)
		} else if (page === ends.length - 1) resolveDone()
	}
	function measure() {
		if (disposed) return
		const anchor = ends[page - 1] ?? 0
		const lineHeight = Number.parseFloat(getComputedStyle(layout).lineHeight)
		const top = layout.getBoundingClientRect().top
		const lines: { start: number; top: number }[] = []
		glyphs.forEach((glyph, index) => {
			const y = glyph.getBoundingClientRect().top - top
			if (!lines.length || y - lines[lines.length - 1].top > lineHeight / 2)
				lines.push({ start: index, top: y })
		})
		ends = []
		offsets = []
		heights = []
		for (let line = 0; line < lines.length; ) {
			let next = Math.min(line + 3, lines.length)
			if (
				next < lines.length &&
				/[。！？、，；：.!?,;:」』）]/u.test(
					glyphs[lines[next - 1].start - 1]?.textContent ?? '',
				)
			)
				next--
			offsets.push(line === 0 ? 0 : lines[line].top - lines[0].top)
			ends.push(lines[next]?.start ?? glyphs.length)
			heights.push((next - line) * lineHeight)
			line = next
		}
		if (!ends.length) {
			ends = [0]
			offsets = [0]
			heights = [lineHeight * 3]
		}
		page = ends.findIndex((end) => end > anchor)
		if (page === -1) page = ends.length - 1
		host.style.height = `${lineHeight * 3}px`
		schedule()
	}
	const observer = new ResizeObserver(measure)
	observer.observe(layout)
	void document.fonts.ready.then(measure)
	measure()
	return {
		finished,
		click() {
			if (awaitingClick && page === ends.length - 1) {
				awaitingClick = false
				resolveDone()
				return true
			}
			if (
				revealed < ends[page] ||
				(page === ends.length - 1 && trailingPending)
			) {
				if (page === ends.length - 1) {
					awaitingClick = options.continueImmediately ?? false
					pause = 0
					trailingPending = false
				}
				revealed = ends[page]
				schedule()
				return true
			}
			if (page + 1 < ends.length) {
				page++
				schedule()
				return true
			}
			return false
		},
		dispose() {
			disposed = true
			clearTimeout(timer)
			observer.disconnect()
			layout.remove()
			window.remove()
			resolveDone()
		},
	}
}
