import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { beforeEach, expect, test, vi } from 'vitest'
import { extractedBookSchema } from '../../packages/creator/src/contract/import'
import { extractEpub } from '../../packages/creator/src/import/epub'
import {
	classifyIllustrations,
	illustrationCandidates,
} from '../../packages/creator/src/import/epub/illustrations'
import type { TextConnection } from '../../packages/creator/src/models/text'
import { artJson } from '../../packages/creator/src/pipeline/art/models'
import { createReplayFetch } from '../../packages/creator/src/replay'
import {
	classificationCases,
	classificationExtraction,
	syntheticDirectory,
	visualConnection,
} from '../fixtures/source/epub/classification'
import {
	providerDirectory,
	providerReplay,
	providerUsage,
	runProviderCases,
} from '../fixtures/source/epub/provider'

vi.mock('../../packages/creator/src/pipeline/art/models', async (original) => {
	const module =
		await original<
			typeof import('../../packages/creator/src/pipeline/art/models')
		>()
	return { ...module, artJson: vi.fn(module.artJson) }
})

const connection: TextConnection = {
	baseUrl: 'https://epub.invalid/v1',
	apiKey: 'offline',
	model: 'gpt-4o',
	format: 'openai-completions',
	compat: 'auto',
	contextWindow: 128_000,
}
const image =
	'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'
const xhtml = (body: string) =>
	`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Hidden</title></head><body>${body}</body></html>`
const nav = xhtml(
	'<nav epub:type="toc"><ol><li><span>Volume A</span><ol><li><a href="chapter.xhtml#one">Nav One</a></li><li><a href="chapter.xhtml#two">Nav Two</a></li></ol></li></ol></nav>',
)
const ncx =
	'<ncx><navMap><navPoint><navLabel><text>NCX One</text></navLabel><content src="chapter.xhtml#one"/></navPoint><navPoint><navLabel><text>NCX Two</text></navLabel><content src="chapter.xhtml#two"/></navPoint></navMap></ncx>'
const body =
	'<h1 id="one">Chapter One</h1><p>First &amp; bright.<a epub:type="noteref">1</a></p><p><img src="images/picture.svg"/></p><aside epub:type="footnote"><p>Not body</p></aside><h2 id="two">Chapter Two</h2><p>Second paragraph.</p>'

async function epub(overrides: Record<string, string | undefined> = {}) {
	const files: Record<string, string | undefined> = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
		'OPS/book.opf':
			'<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Synthetic Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="body" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="image" href="images/picture.svg" media-type="image/svg+xml"/></manifest><spine toc="ncx"><itemref idref="body"/></spine></package>',
		'OPS/chapter.xhtml': xhtml(body),
		'OPS/nav.xhtml': nav,
		'OPS/toc.ncx': ncx,
		'OPS/images/picture.svg': image,
		...overrides,
	}
	const zip = new ZipWriter(new Uint8ArrayWriter())
	for (const [path, source] of Object.entries(files))
		if (source !== undefined) await zip.add(path, new TextReader(source))
	return zip.close()
}

beforeEach(() => {
	vi.mocked(artJson).mockClear()
})

test.skipIf(!process.env.NL_EPUB_PROVIDER_MODE)(
	'EPUB classification provider driver',
	async () => {
		const mode = process.env.NL_EPUB_PROVIDER_MODE
		if (mode !== 'record' && mode !== 'strict' && mode !== 'synthetic')
			throw new Error('Invalid provider mode')
		await runProviderCases(mode)
	},
	180_000,
)

test
	.skipIf(process.env.NL_EPUB_PROVIDER_MODE !== undefined)
	.each(classificationCases)(
	'strict synthetic visual replay: $label',
	async (sample) => {
		const fetch = vi.fn(() => {
			throw new Error('Network must not run')
		})
		const candidates = await classifyIllustrations(
			classificationExtraction(sample),
			sample.bible,
			visualConnection,
			{ replay: { mode: 'strict', directory: syntheticDirectory, fetch } },
		)
		expect(candidates[0]).toMatchObject({
			label: sample.label,
			selected: false,
		})
		expect(fetch).not.toHaveBeenCalled()
	},
)

test('treats an empty provider cassette directory as unset', () => {
	expect(providerDirectory('')).toBe(providerDirectory(undefined))
	expect(providerDirectory('/explicit/private')).toBe('/explicit/private')
})

test('keeps usage reservation when provider token counts are incomplete', () => {
	expect(providerUsage({})).toBeUndefined()
	expect(providerUsage({ prompt_tokens: 10 })).toBeUndefined()
	expect(providerUsage({ completion_tokens: 5 })).toBeUndefined()
	expect(providerUsage({ prompt_tokens: 10, completion_tokens: 5 })).toEqual({
		inputTokens: 10,
		outputTokens: 5,
		total: 15,
	})
	expect(
		providerUsage({ prompt_tokens: -1, completion_tokens: 5 }),
	).toBeUndefined()
})

test('reuses an existing provider request without paying or appending duplicate responses', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-epub-record-'))
	const fetch = vi.fn(
		async () =>
			new Response('first response', {
				headers: { 'content-type': 'text/plain' },
			}),
	)
	try {
		for (let index = 0; index < 2; index++) {
			const replay = createReplayFetch(
				providerReplay(directory, fetch, 'offline-regression'),
			)
			expect(
				await (
					await replay('https://relay.invalid/v1/chat/completions', {
						method: 'POST',
						body: '{"fixture":true}',
					})
				).text(),
			).toBe('first response')
		}
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(
			(await readFile(join(directory, 'cassette.jsonl'), 'utf8'))
				.trim()
				.split('\n'),
		).toHaveLength(1)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('keeps chapter blocks inside article wrappers', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/chapter.xhtml': xhtml(
				'<article><h1 id="one">Chapter One</h1><p>Alpha.</p><p>Beta.</p></article>',
			),
		}),
	)
	expect(book.volumes[0].chapters[0].paragraphs).toEqual([
		'Chapter One',
		'Alpha.',
		'Beta.',
	])
})

test('does not persist HTTP failures that would poison later recording attempts', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'novelive-epub-http-'))
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response('temporary failure', { status: 500 }))
		.mockResolvedValueOnce(new Response('recovered'))
	const request = () =>
		createReplayFetch(providerReplay(directory, fetch, 'offline-http'))(
			'https://relay.invalid/v1/chat/completions',
		)
	try {
		await expect(request()).rejects.toThrow('Provider HTTP 500')
		expect(await (await request()).text()).toBe('recovered')
		expect(await (await request()).text()).toBe('recovered')
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(
			(await readFile(join(directory, 'cassette.jsonl'), 'utf8'))
				.trim()
				.split('\n'),
		).toHaveLength(1)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('keeps TOC chapter breaks at inline anchors', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/chapter.xhtml': xhtml(
				'<h1 id="one">Chapter One</h1><p>First.</p><p><span id="two"/>Second.</p>',
			),
		}),
	)
	expect(book.volumes[0].chapters.map((chapter) => chapter.title)).toEqual([
		'Nav One',
		'Nav Two',
	])
	expect(book.volumes[0].chapters[1].paragraphs).toEqual(['Second.'])
})

test('preserves direct prose around nested block paragraphs', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/chapter.xhtml': xhtml(
				'<blockquote>Before <em>nested</em>.<p>Inside.</p>After.</blockquote>',
			),
		}),
	)
	expect(book.volumes[0].chapters[0].paragraphs).toEqual([
		'Before nested.',
		'Inside.',
		'After.',
	])
})

test('normalizes source wrapping without inventing paragraph or chapter breaks', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/nav.xhtml': undefined,
			'OPS/toc.ncx': undefined,
			'OPS/chapter.xhtml': xhtml(
				'<h1>Chapter\nOne</h1><p>A wrapped\nsentence.<br/>An explicit break.</p>',
			),
		}),
	)
	expect(book.volumes[0].chapters).toHaveLength(1)
	expect(book.volumes[0].chapters[0].paragraphs).toEqual([
		'Chapter One',
		'A wrapped sentence.',
		'An explicit break.',
	])
})

test('keeps footnotes outside prose in chapter notes', async () => {
	const { book } = await extractEpub(await epub())
	expect(book.volumes[0].chapters[0].notes).toEqual(['Not body'])
	expect(book.volumes[0].chapters[0].paragraphs).not.toContain('Not body')
})

test('keeps image-only TOC pages next to the preceding chapter', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/chapter.xhtml': xhtml(
				'<h1 id="one">Chapter One</h1><p>First.</p><h1 id="two">Chapter Two</h1><p>Second.</p><div id="plate"><img src="images/picture.svg"/></div>',
			),
			'OPS/nav.xhtml': nav.replace(
				'</ol></li></ol>',
				'<li><a href="chapter.xhtml#plate">Plate</a></li></ol></li></ol>',
			),
		}),
	)
	expect(book.illustrations[0]).toMatchObject({ chapter: 1 })
	expect(book.volumes[0].chapters).toHaveLength(2)
})

test('does not send invented chapter context for unplaced images', async () => {
	const extraction = await extractEpub(
		await epub({ 'OPS/chapter.xhtml': xhtml('<p>Opening text.</p>') }),
	)
	vi.mocked(artJson).mockResolvedValueOnce({
		label: 'irrelevant',
		reason: 'Decoration',
	})
	await classifyIllustrations(extraction, 'Bible', connection, {})
	const prompt = vi.mocked(artJson).mock.lastCall?.[1]
	expect(prompt).not.toContain('Opening text.')
	expect(prompt).toContain('"chapter":null')
	expect(prompt).toContain('"nearby":""')
})

test('does not promote subsection or non-chapter headings', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/nav.xhtml': undefined,
			'OPS/toc.ncx': undefined,
			'OPS/chapter.xhtml': xhtml(
				'<h2>Reading notes</h2><p>One.</p><h4>Chapter detail</h4><p>Two.</p>',
			),
		}),
	)
	expect(book.navigation).toBe('spine')
	expect(book.volumes[0].chapters).toHaveLength(1)
})

test('heading fallback does not merge a spine document with an unmatched title', async () => {
	const opf =
		'<package><manifest><item id="one" href="chapter.xhtml"/><item id="two" href="second.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'
	const { book } = await extractEpub(
		await epub({
			'OPS/book.opf': opf,
			'OPS/chapter.xhtml': xhtml('<h1>Chapter One</h1><p>First.</p>'),
			'OPS/second.xhtml': xhtml('<h1>The Crossing</h1><p>Second.</p>'),
		}),
	)
	expect(book.navigation).toBe('heading')
	expect(book.volumes[0].chapters.map((chapter) => chapter.title)).toEqual([
		'Chapter One',
		'The Crossing',
	])
	expect(book.volumes[0].chapters[1].paragraphs).toEqual([
		'The Crossing',
		'Second.',
	])
})

test('retains notes before the first TOC chapter', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/chapter.xhtml': xhtml(
				`<section epub:type="copyright-page"><p>Synthetic copyright note.</p></section>${body}`,
			),
		}),
	)
	expect(book.volumes[0].chapters[0].notes).toEqual([
		'Synthetic copyright note.',
		'Not body',
	])
	expect(book.volumes[0].chapters[0].paragraphs).not.toContain(
		'Synthetic copyright note.',
	)
})

test('excludes cover and notes-only files from heading coverage', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/book.opf':
				'<package><manifest><item id="cover" href="cover.xhtml"/><item id="notes" href="notes.xhtml"/><item id="body" href="chapter.xhtml"/><item id="image" href="images/picture.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="cover"/><itemref idref="notes"/><itemref idref="body"/></spine></package>',
			'OPS/cover.xhtml': xhtml('<img src="images/picture.svg"/>'),
			'OPS/notes.xhtml': xhtml(
				'<section epub:type="copyright-page"><p>Copyright note.</p></section>',
			),
		}),
	)
	expect(book.navigation).toBe('heading')
	expect(book.volumes[0].chapters).toHaveLength(2)
	expect(book.volumes[0].chapters[0].notes).toContain('Copyright note.')
})

test.each([false, true])(
	'preserves the first prose preface with cover=%s',
	async (cover) => {
		const { book } = await extractEpub(
			await epub({
				'OPS/book.opf': `<package><manifest><item id="cover" href="cover.xhtml"/><item id="body" href="chapter.xhtml"/><item id="image" href="images/picture.svg" media-type="image/svg+xml"/></manifest><spine>${cover ? '<itemref idref="cover"/>' : ''}<itemref idref="body"/></spine></package>`,
				'OPS/cover.xhtml': xhtml('<img src="images/picture.svg"/>'),
				'OPS/chapter.xhtml': xhtml(
					'<p>Preface.</p><h1>Chapter One</h1><p>First.</p>',
				),
			}),
		)
		expect(book.navigation).toBe('heading')
		expect(
			book.volumes[0].chapters.map((chapter) => chapter.paragraphs),
		).toEqual([['Preface.'], ['Chapter One', 'First.']])
	},
)

test('keeps a later spine file epigraph with that file chapter', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/book.opf':
				'<package><manifest><item id="one" href="chapter.xhtml"/><item id="two" href="second.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
			'OPS/chapter.xhtml': xhtml('<h1>Chapter One</h1><p>First.</p>'),
			'OPS/second.xhtml': xhtml(
				'<p>Second epigraph.</p><h1>Chapter Two</h1><p>Second.</p>',
			),
		}),
	)
	expect(book.volumes[0].chapters[0].paragraphs).toEqual([
		'Chapter One',
		'First.',
	])
	expect(book.volumes[0].chapters[1].paragraphs).toEqual([
		'Second epigraph.',
		'Chapter Two',
		'Second.',
	])
})

test('nav wins over NCX and headings, preserves nested volume and same-file anchors', async () => {
	const result = await extractEpub(await epub())
	expect(compile(extractedBookSchema).validate(result.book).ok).toBe(true)
	expect(result.book).toMatchObject({
		format: 'epub',
		navigation: 'nav',
		metadata: { title: 'Synthetic Book', language: 'en' },
	})
	expect(result.book.volumes[0].title).toBe('Volume A')
	expect(
		result.book.volumes[0].chapters.map((chapter) => chapter.title),
	).toEqual(['Nav One', 'Nav Two'])
	expect(result.book.volumes[0].chapters[0].paragraphs).toEqual([
		'Chapter One',
		'First & bright.',
	])
	expect(result.book.illustrations).toEqual([
		{
			archivePath: 'OPS/images/picture.svg',
			volume: 0,
			chapter: 0,
			paragraph: 1,
		},
	])
	expect(result.images.get('OPS/images/picture.svg')).toEqual(
		new TextEncoder().encode(image),
	)
	expect(await extractEpub(await epub())).toEqual(result)
})

test.each([
	['missing nav', undefined],
	['malformed nav', '<broken>'],
	['empty nav', xhtml('<nav epub:type="toc"/>')],
	[
		'unusable nav',
		xhtml('<nav epub:type="toc"><a href="missing.xhtml">Missing</a></nav>'),
	],
])('falls back to NCX for %s', async (_, source) => {
	const { book } = await extractEpub(await epub({ 'OPS/nav.xhtml': source }))
	expect(book.navigation).toBe('ncx')
	expect(book.volumes[0].chapters.map((chapter) => chapter.title)).toEqual([
		'NCX One',
		'NCX Two',
	])
})

test('falls back to headings then spine without losing paragraph boundaries', async () => {
	const overrides = { 'OPS/nav.xhtml': undefined, 'OPS/toc.ncx': undefined }
	const heading = await extractEpub(await epub(overrides))
	expect(heading.book.navigation).toBe('heading')
	expect(heading.book.volumes[0].chapters).toHaveLength(2)
	const spine = await extractEpub(
		await epub({
			...overrides,
			'OPS/chapter.xhtml': xhtml('<p>Alpha</p><p>Beta</p>'),
		}),
	)
	expect(spine.book.navigation).toBe('spine')
	expect(spine.book.volumes[0].chapters[0].paragraphs).toEqual([
		'Alpha',
		'Beta',
	])
	expect(spine.book.illustrations).toEqual([
		{ archivePath: 'OPS/images/picture.svg', volume: 0, chapter: 0 },
	])
})

test('preserves preface and splits nested NCX volume leaves', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/nav.xhtml': undefined,
			'OPS/chapter.xhtml': xhtml(`<p>Preface text</p>${body}`),
			'OPS/toc.ncx': `<ncx><navMap><navPoint><navLabel><text>NCX Volume</text></navLabel><content src="chapter.xhtml"/>${ncx.replace('<ncx><navMap>', '').replace('</navMap></ncx>', '')}</navPoint></navMap></ncx>`,
		}),
	)
	expect(book.volumes.map((volume) => volume.title)).toEqual([
		'正文',
		'NCX Volume',
	])
	expect(book.volumes[0].chapters[0].paragraphs).toEqual(['Preface text'])
	expect(book.illustrations[0]).toMatchObject({
		volume: 1,
		chapter: 0,
		paragraph: 1,
	})
})

test('accepts standard XHTML doctypes', async () => {
	const { book } = await extractEpub(
		await epub({
			'OPS/nav.xhtml': undefined,
			'OPS/toc.ncx': undefined,
			'OPS/chapter.xhtml': `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">${xhtml('<h1>Chapter One</h1>')}`,
		}),
	)
	expect(book.navigation).toBe('heading')
	expect(book.volumes[0].chapters[0].title).toBe('Chapter One')
})

test('spine order, not manifest or navigation order, determines text order across documents', async () => {
	const original = await epub()
	const { ZipReader, Uint8ArrayReader, TextWriter } = await import(
		'@zip.js/zip.js'
	)
	const reader = new ZipReader(new Uint8ArrayReader(original))
	let opf = ''
	try {
		const entry = (await reader.getEntries()).find(
			(entry) => entry.filename === 'OPS/book.opf',
		)
		if (entry && !entry.directory) opf = await entry.getData(new TextWriter())
	} finally {
		await reader.close()
	}
	const { book } = await extractEpub(
		await epub({
			'OPS/book.opf': opf
				.replace(
					'<manifest>',
					'<manifest><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/>',
				)
				.replace('</spine>', '<itemref idref="second"/></spine>'),
			'OPS/nav.xhtml': xhtml(
				'<nav epub:type="toc"><ol><li><a href="second.xhtml">Later</a></li><li><a href="chapter.xhtml">First</a></li></ol></nav>',
			),
			'OPS/second.xhtml': xhtml('<p>Later text.</p>'),
		}),
	)
	expect(book.volumes[0].chapters.map((chapter) => chapter.title)).toEqual([
		'First',
		'Later',
	])
	expect(book.volumes[0].chapters[1].paragraphs).toEqual(['Later text.'])
})

test.each([
	[{ 'META-INF/container.xml': undefined }, 'Missing EPUB entry'],
	[{ 'OPS/chapter.xhtml': xhtml('') }, 'no extractable text'],
	[{ 'OPS/chapter.xhtml': '<html>' }, 'unclosed tag'],
	[{ 'OPS/images/picture.svg': undefined }, 'Missing EPUB image'],
	[{ '../escape': 'bad' }, 'Unsafe'],
	[
		{
			'OPS/chapter.xhtml': xhtml(
				'<p>Text</p><img src="https://outside.invalid/a.png"/>',
			),
		},
		'External EPUB reference',
	],
	[
		{ 'OPS/chapter.xhtml': '<!DOCTYPE html [<!ENTITY test "bad">]><html/>' },
		'DTD',
	],
])('rejects invalid EPUB input %#', async (overrides, message) => {
	await expect(extractEpub(await epub(overrides))).rejects.toThrow(message)
})

test('all labels remain human-selected candidates and receive nearby text and bible', async () => {
	const extraction = await extractEpub(await epub())
	expect(illustrationCandidates(extraction)[0]).toMatchObject({
		label: 'unclassified',
		selected: false,
	})
	for (const label of ['character', 'scene', 'irrelevant'] as const) {
		vi.mocked(artJson).mockResolvedValueOnce({
			label,
			reason: 'Synthetic suggestion',
		})
		const candidates = await classifyIllustrations(
			extraction,
			'A red character',
			connection,
			{ replay: { mode: 'strict' } },
		)
		expect(candidates[0]).toMatchObject({ label, selected: false })
		expect(vi.mocked(artJson).mock.lastCall?.[1]).toContain('First & bright.')
		expect(vi.mocked(artJson).mock.lastCall?.[1]).toContain('A red character')
	}
	await expect(
		classifyIllustrations(
			{ ...extraction, book: { ...extraction.book, illustrations: [] } },
			'',
			connection,
			{},
		),
	).resolves.toEqual([])
})

test('strict visual replay fails closed for the missing EPUB classification cassette without network', async () => {
	const extraction = await extractEpub(await epub())
	const fetch = vi.fn(() => {
		throw new Error('Network must not run')
	})
	await expect(
		classifyIllustrations(extraction, 'Synthetic bible', connection, {
			replay: { mode: 'strict', fetch },
		}),
	).rejects.toThrow('Missing strict replay cassette:')
	expect(fetch).not.toHaveBeenCalled()
})

test('classification errors propagate and never silently discard manual candidates', async () => {
	const extraction = await extractEpub(await epub())
	vi.mocked(artJson).mockRejectedValueOnce(new Error('invalid classification'))
	await expect(
		classifyIllustrations(extraction, '', connection, {}),
	).rejects.toThrow('invalid classification')
	expect(illustrationCandidates(extraction)).toHaveLength(1)
})
