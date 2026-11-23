import { getEncoding } from 'js-tiktoken'

const framingAllowance = 1024
let encodings: ReturnType<typeof getEncoding>[] | undefined

export function reserveTokenFields(fields: string[], outputCap: number) {
	encodings ??= [getEncoding('o200k_base'), getEncoding('cl100k_base')]
	const estimatedTokens = Math.max(
		...encodings.map((encoding) =>
			fields.reduce(
				(sum, field) => sum + encoding.encode(field, [], []).length,
				0,
			),
		),
	)
	const estimatedInput =
		Math.ceil((estimatedTokens * 115) / 100) + framingAllowance
	const estimate = estimatedInput + outputCap
	const ceiling =
		fields.reduce((sum, field) => sum + Buffer.byteLength(field), 0) +
		framingAllowance +
		outputCap
	return { estimatedInput, estimate, reserved: Math.max(estimate, ceiling) }
}
