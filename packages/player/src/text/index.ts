import type { Inline } from '@novelive/format/script'
import { textTiming } from './timing'
import './text.css'

export interface TextOptions {
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
	const stack: HTMLElement[] = [layout]
	let pause = trailingPause
	let trailingPending = trailingPause > 0
	for (const part of content) {
		const current = stack[stack.length - 1]
		if (part.type === 'pause') continue
		if (part.type === 'open') {
			const element = document.createElement(
				part.name === 'ruby' ? 'ruby' : 'span',
			)
			element.dataset.mark = part.name
			element.className = `nl-text-mark-${part.name}`
			if (part.name === 'ruby') element.dataset.reading = part.argument ?? ''
			current.append(element)
			stack.push(element)
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
				glyph.textContent = segment
				current.append(glyph)
				glyphs.push(glyph)
			}
		}
	}
	const display = layout.cloneNode(true) as HTMLElement
	display.className = 'nl-text-display'
	display.removeAttribute('aria-hidden')
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
			resolveDone()
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
		page = ends.findIndex(end => end > anchor)
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
			if (revealed < ends[page] || (page === ends.length - 1 && trailingPending)) {
				if (page === ends.length - 1) {
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
