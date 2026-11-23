type BudgetUsage = {
	tokens: number | null
	images: number | null
	reservedTokens: number
	reservedImages: number
}

const textContextLimits = new Map([
	['devin-swe-2', 256 * 1024],
	['deepseek-v4.1-flash', 1024 * 1024],
])

export function reserveSmokeTextTokens(
	model: string,
	bodyBytes: number,
	maxOutputTokens: number,
) {
	const serializedLimit = bodyBytes + 32_768
	const context = textContextLimits.get(model)
	if (context === undefined) return serializedLimit
	// Inline images travel as base64, but the relay meters model input tokens.
	// Use the provider context ceiling, not the app's smaller prompt target.
	return Math.min(serializedLimit, context + maxOutputTokens)
}

export function fitsSmokeBudget(
	rows: readonly BudgetUsage[],
	tokens: number,
	images: number,
) {
	return (
		rows.length < 75 &&
		rows.reduce(
			(total, row) => total + (row.tokens ?? row.reservedTokens),
			tokens,
		) <= 5_000_000 &&
		rows.reduce(
			(total, row) => total + (row.images ?? row.reservedImages),
			images,
		) <= 10
	)
}
