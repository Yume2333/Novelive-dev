import { useEffect } from 'react'
import { setLocale } from '../i18n'

/** Applies the saved language and theme; used by every top-level route. */
export function useAppearance(config: object | undefined) {
	const theme = config && 'theme' in config ? config.theme : 'system'
	const language = config && 'language' in config ? config.language : undefined

	useEffect(() => {
		if (language) setLocale(language)
	}, [language])

	useEffect(() => {
		const query = window.matchMedia('(prefers-color-scheme: dark)')
		const apply = () => {
			document.documentElement.dataset.theme =
				theme === 'system' ? (query.matches ? 'dark' : 'light') : String(theme)
		}
		apply()
		query.addEventListener('change', apply)
		return () => query.removeEventListener('change', apply)
	}, [theme])

	return { theme, language }
}
