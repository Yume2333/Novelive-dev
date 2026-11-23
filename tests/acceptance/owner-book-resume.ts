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
			/^These \w+ candidates were extracted packet by packet from this volume, .* Return keep as the numbers of the kept candidates\.$/m.test(
				prompt,
			) &&
			/^Chapter progress:$/m.test(prompt) &&
			/^Candidates:\n1 \{/m.test(prompt)
		)
			return 'selection'
	}
	throw new Error('Request did not resume the saved synthesis packet')
}
