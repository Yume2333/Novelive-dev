import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
	bindOwnerBookRunModels,
	checkOwnerBookResumePrompt,
} from '../acceptance/owner-book-resume'

test('W4 reuses a directory only when its saved selection has matching model provenance', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'novelive-w4-models-'))
	const path = join(dir, 'models.json')
	const models = {
		synthesisModel: 'gemini-3.8-flash',
		selectionModel: 'devin-swe-2',
	}
	try {
		await expect(bindOwnerBookRunModels(path, models, true)).rejects.toThrow(
			'Use a new W4 run directory',
		)
		await bindOwnerBookRunModels(path, models, false)
		await bindOwnerBookRunModels(path, models, true)
		await expect(
			bindOwnerBookRunModels(
				path,
				{ ...models, selectionModel: models.synthesisModel },
				true,
			),
		).rejects.toThrow('Use a new W4 run directory')
		expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(models)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

const prefix = 'Synthesize the ordered chapter previews in zh-TW.'
const expected = { packet: 2, events: 3 }
const extraction = (packet: number, events: number) =>
	`${prefix}
Extract only the next event in packet ${packet}/4. Include progress and every qualifying entry.
Events already extracted: ${events}`

test('owner-book resume requires the saved extraction packet and event count', () => {
	expect(checkOwnerBookResumePrompt(extraction(2, 3), expected)).toBe(
		'extraction',
	)
	expect(() => checkOwnerBookResumePrompt(extraction(1, 3), expected)).toThrow(
		'Request did not resume the saved synthesis packet',
	)
	expect(() => checkOwnerBookResumePrompt(extraction(2, 2), expected)).toThrow(
		'Request did not resume the saved synthesis packet',
	)
})

test('owner-book resume rejects non-selector prompts containing a candidates heading', () => {
	expect(() =>
		checkOwnerBookResumePrompt(
			`${prefix}\nChapter progress:\nCandidates:\n1 {"id":"bridge"}`,
			expected,
		),
	).toThrow('Request did not resume the saved synthesis packet')
})

test('selection-only resume rejects even valid extraction and preview prompts', () => {
	for (const prompt of [extraction(2, 3), 'Preview fiction in zh-TW.']) {
		expect(() => checkOwnerBookResumePrompt(prompt)).toThrow(
			'Request did not resume the saved synthesis packet',
		)
	}
})
