import { expect, test } from 'vitest'
import {
	fitsSmokeBudget,
	reserveSmokeTextTokens,
} from '../../tools/smoke-budget'

test('admits a large serialized vision review at the recorded smoke totals', () => {
	const settled = {
		tokens: 53_160,
		images: 4,
		reservedTokens: 0,
		reservedImages: 0,
	}
	const rows = [
		settled,
		...Array(23).fill({
			tokens: 0,
			images: 0,
			reservedTokens: 131_072,
			reservedImages: 1,
		}),
	]
	const serializedBytes = 5_000_000
	expect(fitsSmokeBudget(rows, serializedBytes + 32_768, 0)).toBe(false)
	const reservation = reserveSmokeTextTokens(
		'devin-swe-2',
		serializedBytes,
		6_000,
	)
	expect(reservation).toBe(268_144)
	expect(fitsSmokeBudget(rows, reservation, 0)).toBe(true)
})

test('keeps byte reservations for small requests and unknown models', () => {
	expect(reserveSmokeTextTokens('devin-swe-2', 1_000, 6_000)).toBe(33_768)
	expect(reserveSmokeTextTokens('unknown', 5_000_000, 6_000)).toBe(5_032_768)
})

test('retains reservations until each usage dimension settles and enforces all caps', () => {
	const open = {
		tokens: null,
		images: null,
		reservedTokens: 131_072,
		reservedImages: 1,
	}
	expect(fitsSmokeBudget([open], 5_000_000 - 131_072, 9)).toBe(true)
	expect(fitsSmokeBudget([open], 5_000_001 - 131_072, 9)).toBe(false)
	expect(fitsSmokeBudget([{ ...open, tokens: 0 }], 5_000_000, 10)).toBe(false)
	expect(
		fitsSmokeBudget([{ ...open, tokens: 0, images: 0 }], 5_000_000, 10),
	).toBe(true)
	expect(
		fitsSmokeBudget(Array(75).fill({ ...open, tokens: 0, images: 0 }), 1, 0),
	).toBe(false)
})
