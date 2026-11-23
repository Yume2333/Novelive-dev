import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { type Locale, locales, resources } from '../locales'

export { type Locale, locales }

const storageKey = 'novelive.language'

export const localeNames: Record<Locale, string> = {
	'zh-CN': '简体中文',
	'zh-TW': '繁體中文',
	en: 'English',
	ja: '日本語',
}

const isLocale = (value: unknown): value is Locale =>
	locales.includes(value as Locale)

function stored(): Locale {
	try {
		const value = localStorage.getItem(storageKey)
		return isLocale(value) ? value : 'zh-CN'
	} catch {
		return 'zh-CN'
	}
}

export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
	resources,
	lng: stored(),
	fallbackLng: {
		'zh-TW': ['zh-CN'],
		ja: ['en', 'zh-CN'],
		default: ['zh-CN'],
	},
	keySeparator: false,
	nsSeparator: false,
	returnNull: false,
	interpolation: { escapeValue: false },
	initAsync: false,
})

if (typeof document !== 'undefined')
	document.documentElement.lang = i18n.language

export function setLocale(value: unknown) {
	const locale = isLocale(value) ? value : 'zh-CN'
	try {
		localStorage.setItem(storageKey, locale)
	} catch {}
	document.documentElement.lang = locale
	window.dispatchEvent(new CustomEvent('novelive:language', { detail: locale }))
	if (i18n.language !== locale) void i18n.changeLanguage(locale)
}

export const scoped =
	(ns: string) =>
	(key: string, values?: Record<string, unknown>): string =>
		i18n.t(key, { ns, ...values }) as string

export const msg = (key: string) => key
