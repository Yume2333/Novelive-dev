import { readFile, writeFile } from 'node:fs/promises'

export async function bindOwnerBookRunModels(
	path: string,
	models: {
		synthesisModel: string
		selectionModel: string
		selectionConsensus?: { rounds: number; minimumVotes: number }
	},
	hasSavedSelection: boolean,
) {
	const stored = await readFile(path, 'utf8').catch((error) => {
		if (error.code !== 'ENOENT') throw error
	})
	const expected = `${JSON.stringify(models)}\n`
	if (stored === expected) return
	if (stored !== undefined || hasSavedSelection)
		throw new Error(
			'Use a new W4 run directory when saved model provenance is missing or different',
		)
	await writeFile(path, expected, { flag: 'wx', mode: 0o600 })
}

export function checkOwnerBookResumePrompt(
	prompt: unknown,
	expected?: { packet: number; events: number },
) {
	if (
		typeof prompt === 'string' &&
		prompt.startsWith('Synthesize the ordered chapter previews')
	) {
		const packet = /^Extract only the next event in packet (\d+)\/\d+\./m.exec(
			prompt,
		)
		if (packet) {
			const events = /^Events already extracted: (\d+)$/m.exec(prompt)
			if (
				expected &&
				Number(packet[1]) === expected.packet &&
				Number(events?.[1]) === expected.events
			)
				return 'extraction'
		} else if (
			/^Select from these canonical candidates across the whole volume\. .* Return keep as the numbers of the kept candidates\.$/m.test(
				prompt,
			) &&
			/^Chapter progress:$/m.test(prompt) &&
			/^Candidates:\n[1-9]\d* \{/m.test(prompt)
		)
			return 'selection'
	}
	throw new Error('Request did not resume the saved synthesis packet')
}
