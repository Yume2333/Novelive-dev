import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

export const root = join(import.meta.dirname, '../..')
export const localeDir = join(root, 'packages/ui/src/locales')
export const sourceLocale = 'zh-CN'
export const targetLocales = ['zh-TW', 'en', 'ja'] as const
const sources = [
	join(root, 'packages/ui/src'),
	join(root, 'apps/desktop/src/main'),
]
const cjk = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/

export function namespaceOf(file: string) {
	const parts = relative(root, file).split(sep)
	if (parts[0] === 'apps') return 'main'
	const [area, name] = parts.slice(3)
	if (area === 'pages' || area === 'panels') return name
	return name === undefined ? 'shell' : area
}

export const placeholders = (text: string) =>
	[...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort()

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory())
			return ['locales', 'i18n'].includes(entry.name) ? [] : files(path)
		return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')
			? [path]
			: []
	})
}

export type Collected = {
	messages: Record<string, string[]>
	scopes: { file: string; scope: string; expected: string }[]
	stray: string[]
}

export function collect(): Collected {
	const messages: Record<string, Set<string>> = {}
	const scopes: Collected['scopes'] = []
	const stray: string[] = []
	for (const file of sources.flatMap(files)) {
		const text = readFileSync(file, 'utf8')
		const ns = namespaceOf(file)
		const source = ts.createSourceFile(
			file,
			text,
			ts.ScriptTarget.Latest,
			true,
			file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		)
		const where = (node: ts.Node) =>
			`${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
		const visit = (node: ts.Node): void => {
			if (ts.isImportDeclaration(node) || ts.isLiteralTypeNode(node)) return
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.arguments[0] &&
				ts.isStringLiteralLike(node.arguments[0])
			) {
				const name = node.expression.text
				const key = node.arguments[0].text
				if (name === 't' || name === 'msg') {
					messages[ns] ??= new Set()
					messages[ns].add(key)
					node.arguments.slice(1).forEach(visit)
					return
				}
				if (name === 'scoped')
					scopes.push({ file: where(node), scope: key, expected: ns })
			}
			if (
				(ts.isStringLiteralLike(node) || ts.isJsxText(node)) &&
				cjk.test(node.text)
			)
				stray.push(`${where(node)} ${node.text.trim()}`)
			if (
				ts.isTemplateExpression(node) &&
				[node.head, ...node.templateSpans.map((span) => span.literal)].some(
					(part) => cjk.test(part.text),
				)
			)
				stray.push(`${where(node)} ${node.getText()}`)
			ts.forEachChild(node, visit)
		}
		visit(source)
	}
	return {
		messages: Object.fromEntries(
			Object.entries(messages)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([ns, keys]) => [ns, [...keys].sort()]),
		),
		scopes,
		stray,
	}
}

export function readLocale(locale: string, ns: string): Record<string, string> {
	try {
		return JSON.parse(
			readFileSync(join(localeDir, locale, `${ns}.json`), 'utf8'),
		)
	} catch {
		return {}
	}
}

export function extract() {
	const { messages, stray, scopes } = collect()
	const locales = [sourceLocale, ...targetLocales]
	const json = (value: unknown) => `${JSON.stringify(value, null, '\t')}\n`
	for (const locale of locales) {
		mkdirSync(join(localeDir, locale), { recursive: true })
		for (const [ns, keys] of Object.entries(messages)) {
			const current = readLocale(locale, ns)
			const next = Object.fromEntries(
				keys.flatMap((key) =>
					locale === sourceLocale
						? [[key, key]]
						: key in current
							? [[key, current[key]]]
							: [],
				),
			)
			writeFileSync(join(localeDir, locale, `${ns}.json`), json(next))
		}
	}
	const id = (locale: string, ns: string) =>
		`${locale.replace('-', '')}_${ns.replace(/\W/g, '_')}`
	const lines = locales.flatMap((locale) =>
		Object.keys(messages).map(
			(ns) => `import ${id(locale, ns)} from './${locale}/${ns}.json'`,
		),
	)
	writeFileSync(
		join(localeDir, 'index.ts'),
		`${lines.join('\n')}

export const locales = ${JSON.stringify(locales)} as const
export type Locale = (typeof locales)[number]
export const namespaces = ${JSON.stringify(Object.keys(messages))} as const

export const resources = {
${locales
	.map(
		(locale) =>
			`\t'${locale}': {\n${Object.keys(messages)
				.map((ns) => `\t\t'${ns}': ${id(locale, ns)},`)
				.join('\n')}\n\t},`,
	)
	.join('\n')}
}
`,
	)
	const wrong = scopes.filter(({ scope, expected }) => scope !== expected)
	for (const line of [
		...stray,
		...wrong.map(
			(s) => `${s.file} scoped('${s.scope}') should be '${s.expected}'`,
		),
	])
		console.warn(line)
	console.log(
		`${Object.values(messages).flat().length} messages in ${Object.keys(messages).length} namespaces`,
	)
}

const guides: Record<(typeof targetLocales)[number], string> = {
	'zh-TW':
		'Traditional Chinese as used in Taiwan (zh-TW). Use Taiwan software terms (e.g. 設定, 檔案, 匯入, 預覽, 資料夾), not a character-by-character conversion.',
	en: 'English (en). Use sentence case, concise UI wording, and natural English plural-neutral phrasing when a count placeholder is present.',
	ja: 'Japanese (ja). Use natural Japanese software UI wording: concise noun labels for buttons and headings, です/ます for full sentences, and 全角 punctuation where Japanese uses it.',
}

async function translateBatch(
	locale: (typeof targetLocales)[number],
	ns: string,
	keys: string[],
) {
	const base = process.env.NL_IMAGE_BASE_URL
	const key = process.env.NL_IMAGE_API_KEY
	const model = process.env.NL_TRANSLATE_MODEL ?? 'devin-swe-2'
	if (!base || !key)
		throw new Error(
			'Translation requires NL_IMAGE_BASE_URL and NL_IMAGE_API_KEY',
		)
	const response = await fetch(
		new URL('v1/chat/completions', base.endsWith('/') ? base : `${base}/`),
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${key}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				model,
				temperature: 0.2,
				messages: [
					{
						role: 'system',
						content: `You localize the interface of Novelive, a desktop app that adapts novels into visual novels (import a novel, an AI production pipeline writes scripts and draws art, the user plays, edits and confirms results). Translate Simplified Chinese UI strings into ${guides[locale]}
Rules: keep every {{placeholder}} exactly as written; keep product, file-format and vendor names (Novelive, EPUB, OpenAI, API Key, UTF-8) unchanged; keep leading/trailing punctuation or separators of fragments; strings may be fragments joined around values or links, so translate them so they still read correctly when joined; keep terms consistent across strings (设定集 is the story bible, 立绘 is a character sprite, 差分 is an expression variant, 演出 is staging, 出图 is image generation).
Reply with one JSON object mapping every input string to its translation, and nothing else.`,
					},
					{
						role: 'user',
						content: `Namespace: ${ns}\n${JSON.stringify(keys, null, 1)}`,
					},
				],
			}),
		},
	)
	if (!response.ok) throw new Error(`${locale}/${ns}: HTTP ${response.status}`)
	const body = (await response.json()) as {
		choices: { message: { content: string } }[]
		usage?: { total_tokens?: number }
	}
	const text = body.choices[0]?.message.content ?? ''
	const parsed = JSON.parse(
		text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1),
	) as Record<string, unknown>
	const usage = process.env.NL_USAGE_CSV
	if (usage)
		writeFileSync(
			usage,
			`${new Date().toISOString().slice(0, 10)},${model},1,${body.usage?.total_tokens ?? ''},0,M5 locales ${locale}/${ns}\n`,
			{ flag: 'a' },
		)
	return Object.fromEntries(
		keys.flatMap((source) => {
			const value = parsed[source]
			return typeof value === 'string' &&
				value.trim() &&
				placeholders(value).join() === placeholders(source).join()
				? [[source, value]]
				: []
		}),
	)
}

export async function translate() {
	const { messages } = collect()
	await Promise.all(
		targetLocales.map(async (locale) => {
			for (const [ns, keys] of Object.entries(messages)) {
				const current = readLocale(locale, ns)
				for (let attempt = 0; attempt < 2; attempt += 1) {
					const missing = keys.filter((key) => !(key in current))
					if (!missing.length) break
					Object.assign(current, await translateBatch(locale, ns, missing))
				}
				const left = keys.filter((key) => !(key in current))
				if (left.length)
					console.warn(`${locale}/${ns}: ${left.length} untranslated`)
				writeFileSync(
					join(localeDir, locale, `${ns}.json`),
					`${JSON.stringify(Object.fromEntries(keys.filter((key) => key in current).map((key) => [key, current[key]])), null, '\t')}\n`,
				)
			}
		}),
	)
}

if (import.meta.main) {
	const command = process.argv[2]
	if (command === 'extract') extract()
	else if (command === 'translate') await translate()
	else {
		console.error('usage: node tools/i18n/locales.ts extract|translate')
		process.exitCode = 1
	}
}
