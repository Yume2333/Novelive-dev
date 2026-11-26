import { msg, scoped } from '../i18n'

const t = scoped('format')

/**
 * 原文语言的本地化名称表。键为 BCP-47 语言代码；
 * 表外代码原样展示——那是用户文件里的数据，不是内部 id。
 */
export const languages = [
	['zh-CN', msg('简体中文')],
	['zh-TW', msg('繁体中文')],
	['ja', msg('日语')],
	['en', msg('英语')],
	['ko', msg('韩语')],
] as const

/** 语言代码的本地化名称；未知代码原样返回。 */
export function formatLanguage(code: string): string {
	const entry = languages.find(([value]) => value === code)
	return entry ? t(entry[1]) : code
}
