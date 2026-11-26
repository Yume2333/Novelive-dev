import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	describeTool,
	type ToolDisplayContext,
	toolNames,
} from '../../packages/ui/src/panels/agent/tool-display'

/*
 * 工具卡显示注册表：后端每个工具都有本地化标题与精选行，
 * 内部 id、键名、工具名、uuid、JSON 一律不出现在标题或行里。
 */

const creatorChat = (file: string) =>
	readFileSync(
		join(import.meta.dirname, '../../packages/creator/src/chat', file),
		'utf8',
	)

/** snake_case 工具名 / ch0001 式 id / uuid / 8 位十六进制场景 id */
const machineToken =
	/\b(?:read|propose|spawn|list)_[a-z_]+\b|\bch\d{4}\b|\bp\d{4}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{8}\b/i

function expectClean(text: string, what: string) {
	expect(machineToken.test(text), `${what}: 「${text}」`).toBe(false)
	expect(text, `${what} 不含 JSON`).not.toMatch(/[[\]{}"]/)
	expect(text.trim().length, `${what} 非空`).toBeGreaterThan(0)
}

const ctx: ToolDisplayContext = {
	chapterTitles: { ch0001: '雨夜', ch0002: '潮汐' },
	chapterOrder: ['ch0001', 'ch0002'],
	volumeTitles: { vol01: '第一卷' },
	entryNames: { 'char-lin': '凛' },
	assetInfo: {
		characters: { lin: '凛' },
		costumes: { 'lin/postal': '邮差大衣' },
		expressions: { 'lin/smile': '微笑' },
		locations: { harbor: '旧码头' },
		variants: { 'harbor/dawn': '清晨' },
	},
}

const samples: Record<string, { input: unknown; result?: unknown }> = {
	read_chapter_preview: {
		input: { chapterId: 'ch0001' },
		result: { scenes: ['a', 'b', 'c', 'd'] },
	},
	read_bible: {
		input: { entry: '守塔人', section: '人物', chapterId: 'ch0002' },
		result: '{"年龄":"五十八岁"}',
	},
	read_glossary: { input: {}, result: { terms: ['灯塔', '潮汐'] } },
	read_scene: { input: { chapterId: 'ch0001', sceneId: 'a1b2c3d4' } },
	read_source_range: {
		input: {
			chapterId: 'ch0001',
			fromParagraph: 'p0003',
			toParagraph: 'p0007',
		},
	},
	list_assets: { input: {}, result: { assets: [{}, {}, {}] } },
	read_chapter_manifest: {
		input: { chapterId: 'ch0002' },
		result: { images: [{}, {}] },
	},
	read_task_result: { input: { taskId: 'task-99' }, result: '完成了' },
	propose_bible_change: {
		input: {
			volumeId: 'vol01',
			changes: [{ op: 'update', path: 'character/lin' }],
			reason: '统一守塔人的年龄',
		},
		result:
			"Proposal 3f9c1f2e-0000-4000-8000-abcdefabcdef is awaiting the creator's decision.",
	},
	propose_glossary_change: {
		input: {
			volumeId: 'vol01',
			changes: [{ op: 'add' }],
			reason: '补一条潮汐术语',
		},
	},
	propose_adaptation_notes: {
		input: { text: '海边不写晴天', reason: '突出阴天氛围' },
	},
	propose_rewrite_scene: {
		input: {
			chapterId: 'ch0001',
			sceneId: 'a1b2c3d4',
			instruction: '把对白写得更克制',
			reason: '第 2 场情绪太满',
		},
	},
	propose_redraw_image: {
		input: {
			assetId: 'lin/postal/smile',
			instruction: '笑得更淡一些',
			reason: '表情过强',
		},
	},
	propose_redo_chapter: {
		input: { chapterId: 'ch0002', reason: '节奏太拖' },
	},
	propose_resynthesize_volume: {
		input: { volumeId: 'vol01', reason: '设定变动较大' },
	},
	spawn_agent: {
		input: {
			role: 'reviewer',
			task: '核对凛在全书里的性格表现',
			context: 'ch0001 ch0002',
		},
		result: 'The bridge scene is consistent.',
	},
}

describe('tool display registry', () => {
	it('covers every tool name literally defined in the creator chat sources', () => {
		const sources = [creatorChat('index.ts'), creatorChat('tools.ts')].join(
			'\n',
		)
		const defined = new Set(
			[...sources.matchAll(/'((?:read|propose|spawn|list)_[a-z_]+)'/g)].map(
				(match) => match[1],
			),
		)
		expect([...defined].sort()).toEqual([...toolNames].sort())
	})

	it('yields clean localized titles and rows for every tool', () => {
		for (const name of toolNames) {
			const sample = samples[name]
			if (!sample) throw new Error(`缺少 ${name} 的示例输入`)
			const display = describeTool(
				name,
				JSON.stringify(sample.input),
				sample.result === undefined
					? undefined
					: typeof sample.result === 'string'
						? sample.result
						: JSON.stringify(sample.result),
				ctx,
			)
			expectClean(display.title, `${name} 标题`)
			expect(display.title, `${name} 标题不含工具名`).not.toContain(name)
			for (const row of [...display.args, ...display.results]) {
				expectClean(row.label, `${name} 行标签`)
				expect(
					machineToken.test(row.value),
					`${name} 行值「${row.value}」`,
				).toBe(false)
				expect(row.value.trim().length).toBeGreaterThan(0)
			}
			expect(display.args.length).toBeLessThanOrEqual(3)
			expect(display.results.length).toBeLessThanOrEqual(3)
		}
	})

	it('resolves chapter ordinals into titles like the prototype', () => {
		const display = describeTool(
			'read_chapter_preview',
			JSON.stringify({ chapterId: 'ch0002' }),
			undefined,
			ctx,
		)
		expect(display.title).toBe('查看第 2 章剧本')
		expect(display.args[0]?.value).toBe('第 2 章 · 潮汐')
	})

	it('accepts the record form of chapterOrder', () => {
		const display = describeTool(
			'read_chapter_preview',
			JSON.stringify({ chapterId: 'ch0002' }),
			undefined,
			{ ...ctx, chapterOrder: { ch0001: 1, ch0002: 2 } },
		)
		expect(display.title).toBe('查看第 2 章剧本')
	})

	it('formats source ranges as paragraph ordinals', () => {
		const display = describeTool(
			'read_source_range',
			JSON.stringify({
				chapterId: 'ch0001',
				fromParagraph: 'p0003',
				toParagraph: 'p0007',
			}),
			undefined,
			ctx,
		)
		const range = display.args.find((row) => row.label === '范围')
		expect(range?.value).toBe('第 3–7 段')
	})

	it('resolves asset ids to human labels', () => {
		const display = describeTool(
			'propose_redraw_image',
			JSON.stringify({ assetId: 'lin/postal/smile', reason: '表情过强' }),
			undefined,
			ctx,
		)
		const image = display.args.find((row) => row.label === '图片')
		expect(image?.value).toBe('凛 · 邮差大衣 · 微笑')
	})

	it('keeps patch arrays and machine keys out of curated rows', () => {
		const display = describeTool(
			'propose_bible_change',
			JSON.stringify({
				volumeId: 'vol01',
				changes: [{ op: 'update', path: 'character/lin/age' }],
				reason: '统一年龄',
			}),
			"Proposal 3f9c1f2e-0000-4000-8000-abcdefabcdef is awaiting the creator's decision.",
			ctx,
		)
		for (const row of display.args) expect(row.value).not.toContain('op')
		expect(display.results).toEqual([])
		expect(display.suppressResultText).toBe(true)
	})

	it('falls back without leaking ids when lookups miss', () => {
		const empty: ToolDisplayContext = { chapterTitles: {} }
		for (const [name, input] of [
			['read_chapter_preview', { chapterId: 'ch9999' }],
			['propose_redo_chapter', { chapterId: 'ch9999', reason: '重写' }],
			[
				'propose_resynthesize_volume',
				{ volumeId: 'vol-xyz', reason: '重新综合' },
			],
			[
				'read_source_range',
				{ chapterId: 'ch9999', from: 'p0001', to: 'p0002' },
			],
		] as const) {
			const display = describeTool(
				name,
				JSON.stringify(input),
				undefined,
				empty,
			)
			expect(machineToken.test(display.title), `${name} 标题`).toBe(false)
			for (const row of display.args) {
				expect(row.value, `${name} 行值`).not.toContain('ch9999')
				expect(row.value, `${name} 行值`).not.toContain('vol-xyz')
			}
		}
	})

	it('falls back to generic titles when chapter order is unavailable', () => {
		const display = describeTool(
			'read_chapter_preview',
			JSON.stringify({ chapterId: 'ch0001' }),
			undefined,
			{ chapterTitles: ctx.chapterTitles },
		)
		expect(display.title).toBe('查看章节预览')
	})

	it('marks spawn_agent hidden and propose_* suppressing result text', () => {
		expect(describeTool('spawn_agent', '{}', undefined, ctx).hidden).toBe(true)
		for (const name of toolNames)
			expect(
				describeTool(name, '{}', undefined, ctx).suppressResultText,
				name,
			).toBe(name.startsWith('propose_'))
	})

	it('gives unknown tools a generic localized title and no rows', () => {
		const display = describeTool(
			'unknown_backend_tool',
			'{"chapterId":"ch0001"}',
			'{}',
			ctx,
		)
		expect(display.hidden).toBe(false)
		expectClean(display.title, '未知工具标题')
		expect(display.args).toEqual([])
		expect(display.results).toEqual([])
	})

	it('never throws on malformed input or result', () => {
		for (const name of toolNames) {
			for (const input of [
				undefined,
				null,
				'not json at all',
				'{"broken',
				'[1,2,3]',
				42,
				'{}{}',
			]) {
				expect(() =>
					describeTool(name, input, '{"partial":true', ctx),
				).not.toThrow()
				const display = describeTool(name, input, undefined, ctx)
				expectClean(display.title, `${name} 异常输入标题`)
			}
		}
	})

	it('truncates long free text instead of dumping it whole', () => {
		const long = '很长的理由'.repeat(30)
		const display = describeTool(
			'propose_redo_chapter',
			JSON.stringify({ chapterId: 'ch0001', reason: long }),
			undefined,
			ctx,
		)
		const reason = display.args.find((row) => row.label === '理由')
		expect(reason?.value.length ?? 0).toBeLessThan(120)
	})

	it('resolves bible entry ids to names and drops id-shaped entries', () => {
		// entryNames 命中：id 解析为条目名
		const byId = describeTool(
			'read_bible',
			JSON.stringify({ entry: 'char-lin' }),
			undefined,
			ctx,
		)
		const resolved = byId.args.find((row) => row.label === '条目')
		expect(resolved?.value).toBe('凛')

		// 自然名称（非 id 形状）原样显示
		const byName = describeTool(
			'read_bible',
			JSON.stringify({ entry: '守塔人' }),
			undefined,
			ctx,
		)
		const natural = byName.args.find((row) => row.label === '条目')
		expect(natural?.value).toBe('守塔人')

		// 带大写的连字符自然名不是 id：原样通过
		for (const name of ['Anne-Marie', 'Jean-Luc']) {
			const hyphenated = describeTool(
				'read_bible',
				JSON.stringify({ entry: name }),
				undefined,
				ctx,
			)
			const row = hyphenated.args.find((arg) => arg.label === '条目')
			expect(row?.value).toBe(name)
		}

		// 查不到且明显是 id 形状：舍弃该行，绝不渲染原始 id
		const unresolved = describeTool(
			'read_bible',
			JSON.stringify({ entry: 'char-unknown' }),
			undefined,
			ctx,
		)
		expect(unresolved.args.find((row) => row.label === '条目')).toBeUndefined()
		for (const row of unresolved.args)
			expect(row.value).not.toContain('char-unknown')

		const uuid = describeTool(
			'read_bible',
			JSON.stringify({ entry: '3f9c1f2e-0000-4000-8000-abcdefabcdef' }),
			undefined,
			ctx,
		)
		expect(uuid.args.find((row) => row.label === '条目')).toBeUndefined()
	})
})
