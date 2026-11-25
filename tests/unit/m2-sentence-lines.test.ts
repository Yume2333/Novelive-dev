import { describe, expect, it } from 'vitest'
import {
	parseRich,
	parseSentenceLines,
	removeMarkSpan,
	rewriteMarkSpan,
	scanMarks,
	updateSentenceLine,
} from '../../packages/ui/src/pages/editor/sentence-lines'

describe('sentence-lines', () => {
	it('parses dialogue, inner, narration, caption and skips stage directives', () => {
		const nvs = [
			'scene 码头',
			'source p0001-p0002',
			'@bg dock/fog',
			'@show lin/uniform/calm left',
			': 雾气贴着海面飘过。 #0001',
			'lin: 早安。 #0002',
			'  lin (inner) as 邮差:\t他看起来有点紧张 cont #0003',
			'@caption 第一天 wait #0004',
			'@wait 0.5',
		].join('\n')

		const lines = parseSentenceLines(nvs)
		expect(lines).toHaveLength(4)
		expect(lines[0]).toMatchObject({
			lineNumber: 5,
			lineId: '0001',
			kind: 'narration',
			speaker: undefined,
			displayAs: undefined,
			text: '雾气贴着海面飘过。',
			click: true,
		})
		expect(lines[1]).toMatchObject({
			lineNumber: 6,
			lineId: '0002',
			kind: 'dialogue',
			speaker: 'lin',
			displayAs: undefined,
			text: '早安。',
			click: true,
		})
		expect(lines[2]).toMatchObject({
			lineNumber: 7,
			lineId: '0003',
			kind: 'inner',
			speaker: 'lin',
			displayAs: '邮差',
			text: '他看起来有点紧张',
			click: false,
		})
		expect(lines[3]).toMatchObject({
			lineNumber: 8,
			lineId: '0004',
			kind: 'caption',
			speaker: undefined,
			displayAs: undefined,
			text: '第一天',
			click: true,
		})
	})

	it('updates a single line text or displayAs while preserving line id, markers, indent, and CRLF', () => {
		const nvs =
			'scene 空屋\r\nsource p0001\r\n  lin (inner) as 来客:\t旧句子 cont #0001\r\n: 下一句。 #0002\r\n'
		const updatedText = updateSentenceLine(nvs, 3, { text: '新句子' })
		expect(updatedText).toBe(
			'scene 空屋\r\nsource p0001\r\n  lin (inner) as 来客:\t新句子 cont #0001\r\n: 下一句。 #0002\r\n',
		)

		const updatedAlias = updateSentenceLine(updatedText, 3, {
			displayAs: '旅人',
		})
		expect(updatedAlias).toBe(
			'scene 空屋\r\nsource p0001\r\n  lin (inner) as 旅人:\t新句子 cont #0001\r\n: 下一句。 #0002\r\n',
		)

		const clearedAlias = updateSentenceLine(updatedAlias, 3, {
			displayAs: '',
		})
		expect(clearedAlias).toBe(
			'scene 空屋\r\nsource p0001\r\n  lin (inner):\t新句子 cont #0001\r\n: 下一句。 #0002\r\n',
		)
	})

	it('keeps a sentence parseable even if text is temporarily cleared', () => {
		const nvs = 'scene 空屋\nsource p0001\n: 原文 #0001\n'
		const cleared = updateSentenceLine(nvs, 3, { text: '' })
		expect(cleared).toBe('scene 空屋\nsource p0001\n:  #0001\n')
		const reparsed = parseSentenceLines(cleared)
		expect(reparsed).toHaveLength(1)
		expect(reparsed[0]).toMatchObject({
			lineNumber: 3,
			lineId: '0001',
			text: '',
		})
		const restored = updateSentenceLine(cleared, 3, { text: '重写' })
		expect(restored).toBe('scene 空屋\nsource p0001\n: 重写 #0001\n')
	})

	it('parses, scans, rewrites, and removes inline marks including ruby, speed, wait, and escaped braces', () => {
		const src =
			'这是{em}重点{/em}，{ruby みなと}港{/ruby}口{wait 0.4}和{speed 0.6}慢速{/speed}，{{字面。'
		expect(parseRich(src)).toEqual([
			{ kind: 'text', text: '这是' },
			{ kind: 'mark', mark: 'em', text: '重点' },
			{ kind: 'text', text: '，' },
			{ kind: 'ruby', text: '港', reading: 'みなと' },
			{ kind: 'text', text: '口' },
			{ kind: 'wait', seconds: '0.4' },
			{ kind: 'text', text: '和' },
			{ kind: 'speed', factor: '0.6', text: '慢速' },
			{ kind: 'text', text: '，{字面。' },
		])

		const spans = scanMarks(src)
		expect(spans.map((s) => [s.mark, s.param, s.inner])).toEqual([
			['em', undefined, '重点'],
			['ruby', 'みなと', '港'],
			['wait', '0.4', ''],
			['speed', '0.6', '慢速'],
		])

		const rewritten = rewriteMarkSpan(src, spans[1], 'ruby', 'うみ', '海')
		expect(rewritten).toContain('{ruby うみ}海{/ruby}')

		const removed = removeMarkSpan(src, spans[0])
		expect(removed).toBe(
			'这是重点，{ruby みなと}港{/ruby}口{wait 0.4}和{speed 0.6}慢速{/speed}，{{字面。',
		)
	})
})
