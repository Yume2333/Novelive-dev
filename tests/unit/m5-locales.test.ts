import { describe, expect, it } from 'vitest'
import { i18n, scoped } from '../../packages/ui/src/i18n'
import { locales, namespaces } from '../../packages/ui/src/locales'
import {
	collect,
	placeholders,
	readLocale,
	sourceLocale,
	targetLocales,
} from '../../tools/i18n/locales'

const { messages, scopes, stray } = collect()
const cjk = /[\u3400-\u9fff]/

describe('M5 locales', () => {
	it('routes every Simplified Chinese interface string through the catalog', () => {
		expect(stray).toEqual([])
		expect(scopes.filter(({ scope, expected }) => scope !== expected)).toEqual(
			[],
		)
		expect([...namespaces].sort()).toEqual(Object.keys(messages).sort())
		expect(locales).toEqual([sourceLocale, ...targetLocales])
	})

	it('keeps the source catalog identical to the source copy', () => {
		for (const [ns, keys] of Object.entries(messages))
			expect(readLocale(sourceLocale, ns), ns).toEqual(
				Object.fromEntries(keys.map((key) => [key, key])),
			)
	})

	it.each(targetLocales)(
		'%s covers every key with matching placeholders',
		(locale) => {
			for (const [ns, keys] of Object.entries(messages)) {
				const table = readLocale(locale, ns)
				expect(Object.keys(table).sort(), `${locale}/${ns}`).toEqual(keys)
				for (const key of keys) {
					const value = table[key]
					expect(value.trim(), `${locale}/${ns}: ${key}`).not.toBe('')
					expect(placeholders(value), `${locale}/${ns}: ${key}`).toEqual(
						placeholders(key),
					)
					if (locale === 'en')
						expect(value, `en/${ns}: ${key}`).not.toMatch(cjk)
				}
			}
		},
	)

	it('switches language at runtime and falls back to the source copy', async () => {
		const shell = scoped('shell')
		try {
			for (const locale of locales) {
				await i18n.changeLanguage(locale)
				expect(shell('书库')).toBe(readLocale(locale, 'shell')['书库'])
			}
			await i18n.changeLanguage('en')
			expect(
				scoped('library')('有 {{unreadableCount}} 部作品无法读取', {
					unreadableCount: 2,
				}),
			).toContain('2')
			expect(shell('未登记的文案')).toBe('未登记的文案')
		} finally {
			await i18n.changeLanguage(sourceLocale)
		}
	})
})
