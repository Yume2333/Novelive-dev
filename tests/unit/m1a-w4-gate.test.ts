import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { scoreAgainstConsensus } from '../acceptance/bible-patch-score'
import {
	extractConsensusReference,
	scoreOwnerBookAgainstReference,
	type TimelineReference,
} from '../acceptance/owner-book-reference'
import type { WholeBookRun } from '../acceptance/owner-book-targets'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtures = join(repo, 'tests/fixtures/m1a-owner-book')
const evidence = join(repo, '.workflow/evidence/m1a/owner')
const volumeId = 'v0001'
const confirmed = { id: 'wen-suchen', name: '文素臣', aliases: ['文白'] }

const readJson = (directory: string, name: string) =>
	JSON.parse(readFileSync(join(directory, name), 'utf8'))

// The strict gate reads the redacted chunked result published only after a
// passing paid run (see tests/acceptance/owner-book-evidence.ts); until then
// it stays skipped rather than failing the offline suite.
const published =
	existsSync(join(evidence, 'chunked-run.json')) &&
	existsSync(join(evidence, 'w4-consensus.json')) &&
	existsSync(join(fixtures, 'chunked-run.json'))

function chunkedRun(): WholeBookRun & {
	formatVersion: number
	volumeId: string
} {
	return readJson(evidence, 'chunked-run.json')
}

function reportFile() {
	const report: {
		reference: number
		baseline: number
		normalized: number
		confirmedIntact: boolean
		restartRequests: number
		restartIntact: boolean
	} = readJson(evidence, 'w4-consensus.json')
	return report
}

// Rebuilt timeline reference grounded in quoted passages of the public-domain
// source (see w4-metric.md); it replaces the recorded whole runs' mutually
// unmatched timeline entries so the majority consensus covers all 7 chapters.
function timelineReference(): TimelineReference {
	const reference: TimelineReference = readJson(
		fixtures,
		'timeline-reference.json',
	)
	expect(reference.formatVersion).toBe(1)
	expect(reference.volumeId).toBe(volumeId)
	expect(
		reference.entries.every(
			(item) => item.kind === 'timeline' && item.provenance.length > 0,
		),
	).toBe(true)
	return reference
}

function wholeRuns(): WholeBookRun[] {
	const recorded: {
		formatVersion: number
		volumeId: string
		runs: WholeBookRun[]
	} = readJson(fixtures, 'whole-runs.json')
	expect(recorded.formatVersion).toBe(1)
	expect(recorded.volumeId).toBe(volumeId)
	expect(recorded.runs).toHaveLength(3)
	return recorded.runs
}

const secrets =
	/api[-_]?key|bearer |sk-[a-z0-9]{8,}|PRIVATE KEY|NL_IMAGE_BASE_URL|NL_IMAGE_API_KEY/i

test('M1a/07 W4 rebuilt reference yields 44-entry reference and honest 0.64988 whole-run baseline', () => {
	const runs = wholeRuns()
	const reference = timelineReference()
	const consensus = extractConsensusReference(runs, [confirmed])
	expect(scoreAgainstConsensus(runs, consensus, [confirmed]).shared).toBe(37)
	const score = scoreOwnerBookAgainstReference(
		runs,
		reference,
		{ biblePatch: [], glossaryPatch: [] },
		[confirmed],
	)
	expect(score.reference).toBe(44)
	expect(score.baseline).toBeCloseTo(0.64988389, 5)
	for (const run of runs) {
		const whole = scoreOwnerBookAgainstReference(runs, reference, run, [
			confirmed,
		])
		expect(whole.normalized).toBeGreaterThanOrEqual(1)
	}
})

test.skipIf(!published)(
	'M1a/07 W4 replays the redacted 《野叟曝言》 run against the rebuilt reference',
	() => {
		const chunked = chunkedRun()
		expect(chunked.formatVersion).toBe(1)
		expect(chunked.volumeId).toBe(volumeId)
		const ids = chunked.biblePatch.map(
			({ kind, entry }) => `${kind}:${entry.id}`,
		)
		expect(new Set(ids).size).toBe(ids.length)
		const score = scoreOwnerBookAgainstReference(
			wholeRuns(),
			timelineReference(),
			chunked,
			[confirmed],
		)
		expect(score.normalized).toBeGreaterThanOrEqual(0.9)
		const report = reportFile()
		expect(report.confirmedIntact).toBe(true)
		expect(report.restartRequests).toBe(0)
		expect(report.restartIntact).toBe(true)
		expect(report.reference).toBe(score.reference)
		expect(report.baseline).toBeCloseTo(score.baseline, 5)
		expect(report.normalized).toBeCloseTo(score.normalized, 5)
	},
)

test('M1a/07 W4 evidence files carry no secrets', () => {
	for (const name of readdirSync(evidence))
		expect(readFileSync(join(evidence, name), 'utf8')).not.toMatch(secrets)
	for (const name of readdirSync(fixtures))
		expect(readFileSync(join(fixtures, name), 'utf8')).not.toMatch(secrets)
})

test.skipIf(!published)(
	'M1a/07 W4 evidence and fixture copies of chunked-run.json stay identical',
	() => {
		expect(readFileSync(join(evidence, 'chunked-run.json'), 'utf8')).toBe(
			readFileSync(join(fixtures, 'chunked-run.json'), 'utf8'),
		)
	},
)
