import { readFileSync } from 'node:fs'
import { compile } from '@earendil-works/pi-schema'
import { expect, test } from 'vitest'
import { chapterSchema } from '../../packages/format/src/model'
import {
	chapterScriptSchema,
	compileScript,
	formatScript,
	parseScript,
} from '../../packages/format/src/script'
import { context } from '../fixtures/script/context'

const fixture = readFileSync(
	new URL('../fixtures/script/synthetic.nvs', import.meta.url),
	'utf8',
)
const scalarContext = { ...context, paragraphIds: ['p0001'] }
const single = (body: string) => `scene 窗边\nsource p0001\n${body}\n`
const storedIds = ['aaaabbbb', 'ccccdddd']

test('normalizes BOM, CRLF and one outer fence, parses structured tags and validates AST schema', () => {
	const wrapped = ['\uFEFF```nvs', fixture.trimEnd(), '```', '']
		.join('\r\n')
		.replace(/(?<!\r)\n/g, '\r\n')
	const parsed = parseScript(wrapped, context)
	expect(parsed.diagnostics).toEqual([])
	expect(compile(chapterScriptSchema).check(parsed.scenes)).toBe(true)
	expect(parsed.scenes[0]).toMatchObject({
		line: 2,
		col: 1,
		source: { from: 'p0001', to: 'p0001' },
	})
	expect(parsed.scenes[0].lines[4]).toMatchObject({
		kind: 'dialogue',
		speaker: 'traveler',
		alias: '访客',
		click: false,
		content: expect.arrayContaining([
			{ type: 'pause', seconds: 0.6 },
			{ type: 'open', name: 'ruby', argument: 'ま' },
			{ type: 'close', name: 'speed' },
		]),
	})
	expect(parsed.scenes[1].lines[2]).toMatchObject({
		kind: 'inner',
		content: expect.arrayContaining([
			{ type: 'text', text: '像是从墙里传出。 {？}' },
		]),
	})
})

test('compiles every command to beats, resolves defaults and carries cast across scenes', () => {
	const result = compileScript(fixture, { ...context, sceneIds: storedIds })
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	const first = result.scenes[0].beats
	const second = result.scenes[1].beats
	expect(first.map(({ advance }) => advance)).toEqual([
		{ kind: 'auto' },
		{ kind: 'auto' },
		{ kind: 'click' },
		{ kind: 'click' },
	])
	expect(first[0].actions[0]).toMatchObject({
		args: { transition: 'fade', duration: 1.5 },
	})
	expect(first[0].actions[3]).toMatchObject({
		args: { easing: 'ease-in-out', duration: 0.3 },
	})
	expect(first[3].actions.map(({ name }) => name)).toEqual([
		'zoom',
		'particle',
		'mask',
		'camera',
		'filter',
		'cg',
	])
	expect(first[3].actions[0].args).toEqual({
		scale: 1.08,
		target: 'center',
		duration: 1,
		easing: 'ease-out',
	})
	expect(second[0].actions[0]).toMatchObject({
		args: { transition: 'none', duration: 0.5 },
	})
	expect(second[0].actions[1].assets).toEqual([
		{ id: 'traveler/coat/smile', slot: 'left' },
	])
	expect(second[1].actions[1].assets).toEqual([
		{ id: 'traveler/cloak/calm', slot: 'left' },
	])
	expect(second[1].advance).toEqual({ kind: 'delay', seconds: 0.2 })
	expect(second.at(-1)).toMatchObject({
		actions: [{ name: 'camera' }],
		advance: { kind: 'auto' },
	})
	expect(second.at(-1)?.line).toBeUndefined()
})

test('formats legacy and named options canonically and retains file and sentence IDs on recompile', () => {
	const initial = compileScript(fixture, { ...context, sceneIds: storedIds })
	if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics))
	const canonical = formatScript(initial.scenes.map(({ scene }) => scene))
	expect(canonical).toContain('@bg room/dusk transition fade duration 1.5\n')
	expect(canonical).toContain(
		'@zoom 1.08 target center duration 1 easing ease-out\n',
	)
	expect(canonical).toContain(' cont #a3f9\n')
	const parsed = compileScript(canonical, { ...context, sceneIds: storedIds })
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
	expect(formatScript(parsed.scenes.map(({ scene }) => scene))).toBe(canonical)
	expect(parsed.scenes.map(({ scene }) => scene.id)).toEqual(storedIds)
})

test('retains IDs by position and prefix, rolls over collisions, and reserves removed IDs', () => {
	const initial = compileScript(single('traveler: 旧句 #a3f9\n@wait #1111'), {
		...scalarContext,
		sceneIds: [storedIds[0]],
	})
	if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics))
	const replacement = compileScript(single('traveler: 改写\n: 新行\n@wait'), {
		...scalarContext,
		previous: initial.scenes.map(({ scene }) => scene),
		makeId: () => '1111',
	})
	if (!replacement.ok) throw new Error(JSON.stringify(replacement.diagnostics))
	expect(replacement.scenes[0].scene.id).toBe(storedIds[0])
	const saved = formatScript([replacement.scenes[0].scene])
	expect(saved).toContain('traveler: 改写 #a3f9')
	expect(saved).toContain(': 新行 #0000')
	expect(saved).toContain('@wait #0001')
})

test('reports source, command, argument, tag and duplicate IDs at original input coordinates', () => {
	const input = [
		'\uFEFF```nvs',
		'scene 甲',
		'source p0001',
		'  @wrong',
		'  @bg room/dusk duration -1',
		'  : {oops}话 #a3f9',
		'  @wait #a3f9',
		'scene 乙',
		'  source p0000',
		'```',
	].join('\r\n')
	expect(
		parseScript(input).diagnostics.map(({ code, line, col }) => [
			code,
			line,
			col,
		]),
	).toEqual([
		['E_COMMAND', 4, 3],
		['E_ARGUMENT', 5, 26],
		['E_TAG', 6, 5],
		['E_DUPLICATE_ID', 7, 9],
		['E_SOURCE', 9, 10],
	])
	expect(
		parseScript('```nvs\nscene 甲\nsource p0001').diagnostics[0],
	).toMatchObject({ code: 'E_FENCE', line: 1, col: 1 })
})

test('rejects out-of-range, overlapping, uncovered, and reversed source ranges', () => {
	for (const [input, code] of [
		[single(': 话').replace('p0001', 'p0010'), 'E_SOURCE_RANGE'],
		[single(': 话').replace('p0001', 'p0002-p0001'), 'E_SOURCE_RANGE'],
		[
			`${single(': 话')}scene 乙\nsource p0001-p0002\n: 话`,
			'E_SOURCE_COVERAGE',
		],
		[single(': 话'), 'E_SOURCE_COVERAGE'],
	])
		expect(compileScript(input, context)).toMatchObject({
			ok: false,
			diagnostics: expect.arrayContaining([expect.objectContaining({ code })]),
		})
})

test('uses the same five-digit paragraph IDs in scene source and chapter metadata', () => {
	const result = compileScript('scene 末尾\nsource p9999-p10000\n: 话', {
		...context,
		paragraphIds: ['p9999', 'p10000'],
	})
	expect(result.ok).toBe(true)
	expect(
		compile(chapterSchema).check({
			formatVersion: 1,
			chapterId: 'chapter1',
			title: '末尾',
			paragraphIds: ['p9999', 'p10000'],
			sceneIds: [],
			cg: [],
		}),
	).toBe(true)
})

test('validates asset types, ambiguous aliases, stage presence and speakers separately', () => {
	const result = compileScript(
		single(
			'@cg cg-missing\n@show traveler/coat/calm left\n@bg room/dusk\n@face stranger/sly\nunknown: 话',
		),
		{
			...scalarContext,
			assets: [
				...context.assets.filter(({ id }) => id !== 'room/dusk'),
				{ ...context.assets[1], id: 'room/dusk', type: 'character' },
			],
		},
	)
	expect(result).toMatchObject({ ok: false })
	expect(result.diagnostics.map(({ code, line }) => [code, line])).toEqual([
		['E_ASSET', 3],
		['E_ASSET', 5],
		['E_STAGE', 6],
		['E_SPEAKER', 7],
	])
	const alias = 'room/evening'
	expect(
		compileScript(single(`@bg ${alias}\ntraveler: 话`), {
			...scalarContext,
			assets: context.assets.map((entry) => ({ ...entry, aliases: [alias] })),
		}),
	).toMatchObject({ ok: false, diagnostics: [{ code: 'E_ASSET' }] })
	expect(
		compileScript(single('traveler: 话'), { ...scalarContext, assets: [] }).ok,
	).toBe(true)
})

test('keeps long lines as warnings but rejects mismatched tags, bad numeric ranges and upper-case IDs', () => {
	const long = compileScript(single(`: ${'字'.repeat(91)}`), scalarContext)
	expect(long).toMatchObject({
		ok: true,
		diagnostics: [{ code: 'W_LINE_LONG', line: 3, col: 3 }],
	})
	const invalid = compileScript(
		single('@shake strength 1.2\n@wait -0.1\n: {speed 0}字{/speed} #ABCD'),
		scalarContext,
	)
	expect(invalid.ok).toBe(false)
	expect(invalid.diagnostics.map(({ code }) => code)).toEqual([
		'E_ARGUMENT',
		'E_ARGUMENT',
		'E_ID',
		'E_TAG',
		'E_TAG',
	])
})
