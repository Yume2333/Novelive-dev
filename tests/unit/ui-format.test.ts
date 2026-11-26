import { describe, expect, it } from 'vitest'
import {
	importErrorCodes,
	issueKinds,
	projectErrorCodes,
	shareErrorCodes,
} from '../../packages/creator/src/contract'
import {
	formatAssetLabel,
	humanizeSlug,
} from '../../packages/ui/src/format/asset'
import {
	formatChapterLabel,
	formatChapterLabelFor,
	formatChapterNumeral,
	formatChapterRange,
	formatParagraphLabel,
	formatParagraphRange,
	formatSceneLabel,
	formatSceneLabelFor,
	formatVolumeLabel,
	paragraphOrdinal,
} from '../../packages/ui/src/format/chapter'
import { formatCost } from '../../packages/ui/src/format/cost'
import { humanizeError } from '../../packages/ui/src/format/errors'
import { formatLanguage } from '../../packages/ui/src/format/language'
import {
	collapseHome,
	formatPath,
	middleEllipsis,
} from '../../packages/ui/src/format/path'
import {
	formatWorkTitle,
	workTitlesFromList,
} from '../../packages/ui/src/format/work'

describe('chapter labels', () => {
	it('formats index and title together with half-width spaces', () => {
		expect(formatChapterLabel({ index: 3, title: '雨夜' })).toBe(
			'第 3 章 · 雨夜',
		)
	})

	it('falls back to the ordinal when the title is missing', () => {
		expect(formatChapterLabel({ index: 3 })).toBe('第 3 章')
		expect(formatChapterLabel({ index: 3, title: '  ' })).toBe('第 3 章')
	})

	it('uses the title alone when no ordinal exists', () => {
		expect(formatChapterLabel({ title: '序章' })).toBe('序章')
	})

	it('never returns a raw id and falls back to a generic name', () => {
		expect(formatChapterLabel({})).toBe('未命名章节')
	})

	it('resolves ids through the chapter list without leaking them', () => {
		const chapters = [
			{ chapterId: 'ch0001', title: '雨夜' },
			{ chapterId: 'ch0002' },
		]
		expect(formatChapterLabelFor(chapters, 'ch0001')).toBe('第 1 章 · 雨夜')
		expect(formatChapterLabelFor(chapters, 'ch0002')).toBe('第 2 章')
		expect(formatChapterLabelFor(chapters, 'ch9999')).toBe('未命名章节')
		expect(formatChapterLabelFor(chapters, undefined)).toBe('未命名章节')
		expect(formatChapterLabelFor([], 'ch0001')).not.toContain('ch0001')
	})

	it('pads the row numeral column', () => {
		expect(formatChapterNumeral(0)).toBe('01')
		expect(formatChapterNumeral(11)).toBe('12')
	})

	it('formats chapter ranges', () => {
		expect(formatChapterRange(1, 5)).toBe('第 1–5 章')
	})
})

describe('paragraph labels', () => {
	it('parses pNNNN ids into ordinals', () => {
		expect(formatParagraphLabel('p0007')).toBe('第 7 段')
		expect(formatParagraphLabel('p0123')).toBe('第 123 段')
		expect(formatParagraphLabel(7)).toBe('第 7 段')
	})

	it('never returns the raw id on a miss', () => {
		expect(formatParagraphLabel('xyz')).toBe('')
		expect(formatParagraphLabel('p0000')).toBe('')
		expect(paragraphOrdinal('abc')).toBeUndefined()
	})

	it('formats ranges from ids or ordinals', () => {
		expect(formatParagraphRange('p0001', 'p0005')).toBe('第 1–5 段')
		expect(formatParagraphRange(1, 5)).toBe('第 1–5 段')
		expect(formatParagraphRange('bad', 'p0005')).toBe('')
	})
})

describe('volume and scene labels', () => {
	it('formats volume labels with fallbacks', () => {
		expect(formatVolumeLabel({ index: 2, title: '夏日篇' })).toBe(
			'第 2 卷 · 夏日篇',
		)
		expect(formatVolumeLabel({ index: 2 })).toBe('第 2 卷')
		expect(formatVolumeLabel({ title: '夏日篇' })).toBe('夏日篇')
		expect(formatVolumeLabel({})).toBe('未命名卷')
	})

	it('formats scene ordinals and drops the segment when unknown', () => {
		expect(formatSceneLabel(3)).toBe('第 3 场')
		expect(formatSceneLabel(undefined)).toBe('')
		expect(formatSceneLabel(0)).toBe('')
		expect(formatSceneLabelFor([{ sceneId: 'a3f29b0c' }], 'a3f29b0c')).toBe(
			'第 1 场',
		)
		expect(formatSceneLabelFor([{ sceneId: 'a3f29b0c' }], 'ffffffff')).toBe('')
	})
})

describe('path formatting', () => {
	it('collapses the home directory', () => {
		expect(collapseHome('/home/ada/novelive/work', '/home/ada')).toBe(
			'~/novelive/work',
		)
		expect(collapseHome('/home/ada', '/home/ada')).toBe('~')
		expect(collapseHome('/home/adam/work', '/home/ada')).toBe('/home/adam/work')
	})

	it('strips trailing slashes', () => {
		expect(collapseHome('/home/ada/work/')).toBe('/home/ada/work')
		expect(formatPath('/home/ada/work///')).toBe('/home/ada/work')
	})

	it('middle-truncates long paths keeping head and tail', () => {
		const long = '/home/ada/novelive/projects/some-series/volume-one/work'
		const out = formatPath(long, '/home/ada', 30)
		expect(out.length).toBeLessThanOrEqual(30)
		expect(out).toContain('…')
		expect(out.startsWith('~/')).toBe(true)
		expect(out.endsWith('work')).toBe(true)
	})

	it('leaves short paths untouched', () => {
		expect(formatPath('/tmp/x', '/home/ada')).toBe('/tmp/x')
		expect(middleEllipsis('short', 20)).toBe('short')
	})
})

describe('cost formatting', () => {
	it('rounds to cents', () => {
		expect(formatCost(Math.PI)).toBe('$3.14')
		expect(formatCost(12.5)).toBe('$12.50')
		expect(formatCost(0)).toBe('$0.00')
	})

	it('uses the floor for tiny positive amounts', () => {
		expect(formatCost(0.001)).toBe('< $0.01')
		expect(formatCost(0.009)).toBe('< $0.01')
		expect(formatCost(0.01)).not.toContain('<')
	})
})

describe('asset labels', () => {
	const info = {
		characters: { ada: 'Ada' },
		costumes: { 'ada/uniform': '校服' },
		expressions: { 'ada/neutral': '平常' },
		locations: { room: '活动室' },
		variants: { 'room/day': '白天' },
	}

	it('resolves portraits through bible names and descriptions', () => {
		expect(formatAssetLabel('ada/uniform/neutral', info)).toBe(
			'Ada · 校服 · 平常',
		)
	})

	it('resolves backgrounds through location names and variant descriptions', () => {
		expect(formatAssetLabel('room/day', info)).toBe('活动室 · 白天')
	})

	it('humanizes slugs when the bible lookup misses', () => {
		expect(formatAssetLabel('school-rooftop/night')).toBe(
			'School rooftop · Night',
		)
		expect(formatAssetLabel('ada/uniform/neutral')).toBe(
			'Ada · Uniform · Neutral',
		)
	})

	it('never returns raw separator keys and uses one separator', () => {
		const label = formatAssetLabel('ada/uniform/neutral', info)
		expect(label).not.toContain('/')
		expect(formatAssetLabel('room/day', info)).not.toContain('/')
	})

	it('labels cg keys from descriptions or a generic name', () => {
		expect(formatAssetLabel('cg-9f2e', { cgs: { 'cg-9f2e': '祭典' } })).toBe(
			'祭典',
		)
		expect(formatAssetLabel('cg-school-festival')).toBe('School festival')
		expect(formatAssetLabel('cg-')).toBe('插画')
	})

	it('humanizes slugs', () => {
		expect(humanizeSlug('school-rooftop')).toBe('School rooftop')
		expect(humanizeSlug('night_air')).toBe('Night air')
		expect(humanizeSlug('')).toBe('')
	})
})

describe('work titles', () => {
	const works = [
		{ workId: 'a', title: '纸飞机', published: 1, chapters: 2 },
		{ workId: 'b', title: '纸飞机', published: 1, chapters: 2 },
		{ workId: 'c', title: '夜航', published: 1, chapters: 2 },
	] as const

	it('disambiguates duplicate titles by volume when available', () => {
		const withProject = works.map((work) => ({
			...work,
			project: {
				directory: '/x',
				seriesId: 's',
				seriesTitle: '系列',
				volumeId: 'v',
				volumeTitle: work.workId === 'a' ? '第一卷' : '第二卷',
				volumeIndex: 1,
			},
		}))
		const titles = workTitlesFromList(withProject)
		expect(titles.get('a')).toBe('纸飞机 · 第一卷')
		expect(titles.get('b')).toBe('纸飞机 · 第二卷')
		expect(titles.get('c')).toBe('夜航')
	})

	it('falls back to a localized deleted-work label, never the UUID', () => {
		const titles = workTitlesFromList(works.map((work) => ({ ...work })))
		expect(formatWorkTitle(titles, 'c')).toBe('夜航')
		const missing = formatWorkTitle(titles, 'missing')
		expect(missing).toBe('已删除的作品')
		expect(formatWorkTitle(titles, undefined)).toBe('已删除的作品')
	})
})

describe('language names', () => {
	it('localizes known codes and passes unknown data through', () => {
		expect(formatLanguage('zh-CN')).toBe('简体中文')
		expect(formatLanguage('ko')).toBe('韩语')
		expect(formatLanguage('fr')).toBe('fr')
	})
})

describe('humanizeError', () => {
	it('returns a localized non-raw message for every exported kind and code', () => {
		const rawish = /^[a-z_]+$|\b(?:id|nvs|uuid)\b/i
		for (const kind of issueKinds) {
			const result = humanizeError(kind)
			expect(result.message, kind).not.toBe('')
			expect(result.message, kind).not.toBe(kind)
			expect(result.message, kind).not.toMatch(rawish)
			expect(result.message, kind).not.toContain(kind)
		}
		for (const code of projectErrorCodes) {
			const result = humanizeError(code)
			expect(result.message, code).not.toBe('')
			expect(result.message, code).not.toBe(code)
			expect(result.message, code).not.toContain(code)
		}
		for (const code of importErrorCodes) {
			const result = humanizeError(code)
			expect(result.message, code).not.toBe('')
			expect(result.message, code).not.toBe(code)
			expect(result.message, code).not.toContain(code)
		}
		for (const code of shareErrorCodes) {
			const result = humanizeError(code)
			expect(result.message, code).not.toBe('')
			expect(result.message, code).not.toBe(code)
			expect(result.message, code).not.toContain(code)
		}
	})

	it('reads issue objects with kind and detail', () => {
		const result = humanizeError({ kind: 'network', detail: 'socket reset' })
		expect(result.message).toBe('无法连接模型服务，请检查网络后重试。')
		expect(result.detail).toBe('socket reset')
		expect(result.message).not.toContain('network')
	})

	it('reads command errors with code and message', () => {
		const result = humanizeError({
			code: 'epub_doctype',
			message: 'DOCTYPE is not supported',
		})
		expect(result.message).toBe('这份 EPUB 的格式不受支持，无法导入。')
		expect(result.detail).toBe('DOCTYPE is not supported')
	})

	it('reads code-bearing Error subclasses before the message fallback', () => {
		const failure = Object.assign(new Error('DOCTYPE is not supported'), {
			code: 'epub_doctype' as const,
		})
		const result = humanizeError(failure)
		expect(result.message).toBe('这份 EPUB 的格式不受支持，无法导入。')
		expect(result.detail).toBe('DOCTYPE is not supported')
	})

	it('parses legacy [code] prefixed Error messages', () => {
		const result = humanizeError(
			new Error('[network] Model connection interrupted or unavailable'),
		)
		expect(result.message).toBe('无法连接模型服务，请检查网络后重试。')
		expect(result.detail).toBe('Model connection interrupted or unavailable')
	})

	it('interpolates issue counts for placeholder and matting copy', () => {
		expect(humanizeError({ kind: 'placeholder', count: 3 }).message).toBe(
			'无法生成 3 张图像，已先用占位图代替。',
		)
		expect(
			humanizeError({ kind: 'matting_unavailable', count: 2 }).message,
		).toBe('无法把 2 张立绘处理成透明底。')
		// 没有 count 时退回不带数量的句子
		expect(humanizeError({ kind: 'placeholder' }).message).toBe(
			'无法生成图像，已先用占位图代替。',
		)
		expect(humanizeError({ kind: 'placeholder', count: 0 }).message).toBe(
			'无法生成图像，已先用占位图代替。',
		)
	})

	it('hints recovery where the table provides one', () => {
		expect(humanizeError('budget_paused').hint).toBe(
			'提高预算上限或更换模型后可继续制作。',
		)
		expect(humanizeError('network').hint).toBeUndefined()
	})

	it('falls back to a generic sentence for unknown input, never echoing it', () => {
		const generic = humanizeError('some_unlisted_code')
		expect(generic.message).toBe('无法完成操作，请重试。')
		expect(generic.detail).toBe('some_unlisted_code')
		expect(humanizeError(new Error('weird failure')).message).toBe(
			'无法完成操作，请重试。',
		)
		expect(humanizeError(undefined).message).toBe('无法完成操作，请重试。')
		expect(humanizeError(null).detail).toBeUndefined()
		expect(humanizeError({}).message).toBe('无法完成操作，请重试。')
	})
})
