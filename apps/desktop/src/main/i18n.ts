import { ipcMain } from 'electron'
import en from '../../../../packages/ui/src/locales/en/main.json'
import ja from '../../../../packages/ui/src/locales/ja/main.json'
import zhTW from '../../../../packages/ui/src/locales/zh-TW/main.json'

const tables: Record<string, Record<string, string>[]> = {
	'zh-TW': [zhTW],
	en: [en],
	ja: [ja, en],
}
let locale = 'zh-CN'
const listeners = new Set<() => void>()
let synced: () => void
const ready = new Promise<void>((resolve) => {
	synced = resolve
})

export const languageReady = (timeout: number) =>
	Promise.race([ready, new Promise((resolve) => setTimeout(resolve, timeout))])

export const msg = (key: string) => key

export function t(key: string, values: Record<string, unknown> = {}) {
	const text = tables[locale]?.map((table) => table[key]).find(Boolean) ?? key
	return text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]))
}

export function onLanguage(listener: () => void) {
	listeners.add(listener)
}

ipcMain.on('novelive:language', (_event, value: unknown) => {
	if (typeof value !== 'string') return
	if (value !== 'zh-CN' && !(value in tables)) return
	synced()
	if (value === locale) return
	locale = value
	for (const listener of listeners) listener()
})
