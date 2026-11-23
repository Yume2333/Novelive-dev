export class PackageCodecError extends Error {
	constructor(
		readonly code:
			| 'corrupt_package'
			| 'unsupported_format'
			| 'unsupported_reader'
			| 'invalid_selection'
			| 'write_failed',
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = 'PackageCodecError'
	}
}

export function corrupt(path: string, detail: string, cause?: unknown) {
	return new PackageCodecError('corrupt_package', `${path}: ${detail}`, {
		cause,
	})
}
