import { expect, test } from 'vitest'
import { evaluateFixtures } from '../../tools/quality/run'
import { expected } from '../fixtures/quality/cases'

test('replays the independent judge and measures both synthetic scripts', async () => {
	const report = await evaluateFixtures('strict', undefined, async () => {
		throw new Error('Quality regression must not contact the provider')
	})
	expect(report.summary).toEqual({
		passed: 1,
		failed: 1,
		undecided: 0,
		passRate: 0.5,
	})
	for (const trial of report.trials) {
		expect(trial.mechanics).toMatchObject({ compiled: true, paragraphs: 2 })
		expect(trial).toMatchObject({ failedChecks: expected[trial.id] })
	}
})

test('leaves unavailable judgments out of the pass-rate denominator', async () => {
	const report = await evaluateFixtures('strict', {
		baseUrl: 'https://relay.invalid/not-recorded',
		apiKey: 'offline',
	})
	expect(report.summary).toEqual({
		passed: 0,
		failed: 0,
		undecided: 2,
		passRate: null,
	})
})
