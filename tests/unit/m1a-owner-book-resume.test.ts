import { expect, test } from 'vitest'
import { checkOwnerBookResumePrompt } from '../acceptance/owner-book-resume'

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
