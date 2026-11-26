import { i18n } from '../i18n'

/**
 * 美元花费的统一展示：一律保留到分，正的极小金额
 * 显示为 `< $0.01` 而不是一串四位小数。
 */
export function formatCost(usd: number): string {
	const format = (value: number) =>
		value.toLocaleString(i18n.language, {
			style: 'currency',
			currency: 'USD',
			currencyDisplay: 'narrowSymbol',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		})
	if (!Number.isFinite(usd) || usd <= 0) return format(0)
	if (usd < 0.01) return `< ${format(0.01)}`
	return format(usd)
}
