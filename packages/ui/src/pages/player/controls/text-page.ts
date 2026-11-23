export function textPage(host: HTMLElement) {
	const text = host.querySelector<HTMLElement>('.nl-player-text')
	const window = text?.querySelector('.nl-text-window')
	if (!window)
		return {
			characters: Array.from(text?.textContent ?? '').length,
			pageReady: true,
		}
	const bounds = window.getBoundingClientRect()
	const glyphs = Array.from(
		window.querySelectorAll<HTMLElement>('[data-glyph]'),
	).filter((glyph) => {
		const top = glyph.getBoundingClientRect().top
		return top >= bounds.top - 1 && top < bounds.bottom - 1
	})
	return {
		characters: glyphs.length,
		pageReady:
			glyphs.every((glyph) => glyph.style.visibility === 'visible') &&
			(text?.dataset.page !== text?.dataset.pages ||
				text?.dataset.textFinished === 'true'),
	}
}
