import { useCallback, useEffect, useState } from 'react'
import { setLocale } from '../i18n'

export type ThemeMode = 'light' | 'dark' | 'system'

function parseTheme(config: object | undefined): ThemeMode | undefined {
	if (!config || !('theme' in config)) return undefined
	const value = config.theme
	return value === 'light' || value === 'dark' || value === 'system'
		? value
		: undefined
}

/** Applies the saved language and theme; used by every top-level route. */
export function useAppearance(config: object | undefined) {
	const savedTheme = parseTheme(config)
	const language = config && 'language' in config ? config.language : undefined
	const [optimisticTheme, setOptimisticTheme] = useState<ThemeMode>()
	// 乐观主题只遮蔽外部值一次：一旦保存值追上点击结果就放手，
	// 之后在设置页或外部改的主题照常生效。
	const [prevSavedTheme, setPrevSavedTheme] = useState<ThemeMode | undefined>(
		savedTheme,
	)
	if (savedTheme !== prevSavedTheme) {
		// 挂载后保存值才出现（加载完成），或保存值追上/偏离乐观值：放手。
		if (prevSavedTheme !== undefined || savedTheme === optimisticTheme)
			setOptimisticTheme(undefined)
		setPrevSavedTheme(savedTheme)
	}

	const setTheme = useCallback((next: ThemeMode) => {
		setOptimisticTheme(next)
	}, [])
	const clearOptimisticTheme = useCallback(() => {
		setOptimisticTheme(undefined)
	}, [])

	const theme: ThemeMode = optimisticTheme ?? savedTheme ?? 'system'

	useEffect(() => {
		if (language) setLocale(language)
	}, [language])

	useEffect(() => {
		const query = window.matchMedia('(prefers-color-scheme: dark)')
		const apply = () => {
			document.documentElement.dataset.theme =
				theme === 'system' ? (query.matches ? 'dark' : 'light') : theme
		}
		apply()
		query.addEventListener('change', apply)
		return () => query.removeEventListener('change', apply)
	}, [theme])

	return { theme, language, setTheme, clearOptimisticTheme }
}
