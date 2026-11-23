import {
	compile,
	type Schema,
	type ValidationError,
} from '@earendil-works/pi-schema'

type Shape = {
	type?: string
	const?: unknown
	enum?: unknown[]
	anyOf?: Shape[]
	properties?: Record<string, Shape>
	required?: string[]
	items?: Shape
	minItems?: number
	maxItems?: number
	minLength?: number
	pattern?: string
	additionalProperties?: boolean
}

function describe(schema: Shape, child: (shape: Shape) => string): string {
	if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const)
	if (schema.enum)
		return schema.enum.map((value) => JSON.stringify(value)).join('|')
	if (schema.anyOf) return schema.anyOf.map(child).join('|')
	if (schema.items)
		return `[${child(schema.items)}]${schema.minItems ?? ''}${schema.maxItems === undefined ? '' : `<=${schema.maxItems}`}`
	if (schema.properties) {
		const fields = Object.entries(schema.properties).map(
			([key, field]) =>
				`${key}${schema.required?.includes(key) ? '' : '?'}:${child(field)}`,
		)
		return `{${fields.join(',')}${schema.additionalProperties === false ? '' : ',...'}}`
	}
	return schema.type === 'string'
		? schema.pattern
			? `s/${schema.pattern}/`
			: `s${schema.minLength ?? ''}`
		: schema.type === 'boolean'
			? 'b'
			: (schema.type ?? 'any')
}

function describeShape(schema: Shape) {
	const counts = new Map<string, number>()
	const raw = (shape: Shape): string => describe(shape, raw)
	function count(shape: Shape) {
		const key = raw(shape)
		counts.set(key, (counts.get(key) ?? 0) + 1)
		return describe(shape, count)
	}
	count(schema)
	const definitions = new Map<string, { name: string; value: string }>()
	function reference(shape: Shape): string {
		const key = raw(shape)
		const existing = definitions.get(key)
		if (existing) return existing.name
		const value = describe(shape, reference)
		if (value.length < 16 || (counts.get(key) ?? 0) < 2) return value
		const name = `$${definitions.size + 1}`
		definitions.set(key, { name, value })
		return name
	}
	const output = reference(schema)
	return [
		output,
		...Array.from(
			definitions.values(),
			({ name, value }) => `${name}=${value}`,
		),
	].join('\n')
}

const record = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: undefined

function variants(schema: Shape, value: unknown): Shape[] {
	if (!schema.anyOf) return [schema]
	const fields = record(value)
	const matching = schema.anyOf.filter((variant) =>
		Object.entries(variant.properties ?? {}).some(
			([key, field]) =>
				Object.hasOwn(field, 'const') && field.const === fields?.[key],
		),
	)
	return matching.length ? matching : schema.anyOf
}

function objectRules(schema: Shape, value: unknown, path: string[]) {
	let shapes = [schema]
	for (const key of path) {
		shapes = shapes.flatMap((shape) =>
			variants(shape, value).flatMap((item) => {
				const field = item.items ?? item.properties?.[key]
				return field ? [field] : []
			}),
		)
		value = record(value)?.[key]
	}
	return [
		...new Set(
			shapes.flatMap((shape) =>
				variants(shape, value)
					.filter((variant) => variant.properties)
					.map((variant) => {
						const keys = Object.keys(variant.properties ?? {}).join(', ')
						const allowed =
							variant.additionalProperties === false
								? `allowed keys: ${keys}`
								: `declared keys: ${keys} (additional keys allowed)`
						return `${allowed}; required fields: ${variant.required?.join(', ') || 'none'}`
					}),
			),
		),
	]
}

export function synthesisOutput<T>(schema: Schema<T>) {
	const shape = schema as Shape
	const validator = compile(schema)
	return {
		validator,
		instructions: `JSON shape (s=string, b=boolean, ?=optional, |=or, ...=extra keys allowed, [T]=array; numeric suffix=min length, <=max length): ${describeShape(shape)}`,
		repair(value: unknown, errors: ValidationError[]) {
			const contexts = new Map<string, string[]>()
			for (const { path } of errors) {
				const tokens = path.split('/').slice(1, -1)
				const pointer = tokens.length ? `/${tokens.join('/')}` : '/'
				if (contexts.has(pointer)) continue
				const rules = objectRules(
					shape,
					value,
					tokens.map((token) =>
						token.replaceAll('~1', '/').replaceAll('~0', '~'),
					),
				)
				if (rules.length) contexts.set(pointer, rules)
			}
			return [
				'Return the full corrected JSON object. Validator errors:',
				...errors.map(
					({ path, keyword, message }) =>
						`${path || '/'} [${keyword}]: ${message}`,
				),
				...Array.from(
					contexts,
					([path, rules]) => `${path}: ${rules.join(' OR ')}`,
				),
			].join('\n')
		},
	}
}
