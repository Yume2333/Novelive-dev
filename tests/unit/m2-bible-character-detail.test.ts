import type { CommandOutput } from '@novelive/creator/contract'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
	labelFor,
	OtherFields,
} from '../../packages/ui/src/pages/bible/BibleFields'
import { CharacterDetail } from '../../packages/ui/src/pages/bible/CharacterDetail'

type BibleCharacter = CommandOutput<'bible.get'>['characters'][number]

describe('Story Bible structured character details', () => {
	const xia: BibleCharacter = {
		id: 'xia',
		name: '小夏',
		originalName: '夏初',
		aliases: ['夏夏', '阿夏'],
		major: true,
		status: 'confirmed',
		firstSeenChapter: 'ch01',
		revealedChapter: 'ch02',
		identity: '灯塔实习看守',
		personality: '谨慎细心',
		speech: '语速偏慢，常用短句',
		reuse: 'reusable',
		addresses: [{ speakerId: 'lin', name: '小夏' }],
		appearance: {
			description: '黑发齐肩，常戴旧蓝围巾',
			anchorFeatures: ['左眼角泪痣', '旧蓝围巾'],
			keyColors: { hair: '黑', eyes: '深棕', clothing: '灰蓝' },
		},
		costumes: [
			{ id: 'uniform', description: '海事局实习制服', fromChapter: 'ch01' },
			{ id: 'raincoat', description: '黄色防风雨衣', fromChapter: 'ch03' },
		],
		expressions: [
			{ id: 'calm', description: '平视前方，微抿嘴角' },
			{ id: 'uneasy', description: '眼神略微游移' },
		],
		knows: [{ chapterId: 'ch01', fact: '灯塔备用钥匙在抽屉第二格' }],
		references: [{ path: 'refs/xia-base.png', description: '半身正面参考' }],
		changes: [
			{ chapterId: 'ch02', field: 'personality', value: '更加果断' },
			{ chapterId: 'ch03', field: 'appearance', value: '剪短头发' },
			{ chapterId: 'ch04', field: 'speech', value: '语气坚定' },
		],
	}

	const lin: BibleCharacter = {
		id: 'lin',
		name: '小林',
		aliases: [],
		status: 'confirmed',
	}

	it('renders character attributes as structured elements without concatenated key:value strings', () => {
		const html = renderToStaticMarkup(
			createElement(CharacterDetail, {
				character: xia,
				characters: [xia, lin],
			}),
		)

		expect(html).toContain('小夏')
		expect(html).toContain('夏初')
		expect(html).toContain('灯塔实习看守')
		expect(html).toContain('黑发齐肩，常戴旧蓝围巾')
		expect(html).toContain('左眼角泪痣')
		expect(html).toContain('旧蓝围巾')
		expect(html).toContain('深棕')
		expect(html).toContain('海事局实习制服')
		expect(html).toContain('小林')
		expect(html).toContain('还有 1 条变化')

		expect(html).not.toContain('描述：')
		expect(html).not.toContain('发色：')
		expect(html).not.toContain('瞳色：')
		expect(html).not.toContain('服装：')
		expect(html).not.toContain('说话人：')
		expect(html).not.toContain('ID：')
	})

	it('never shows raw reference file paths or raw chapter ids', () => {
		const html = renderToStaticMarkup(
			createElement(CharacterDetail, {
				character: xia,
				characters: [xia, lin],
			}),
		)

		expect(html).toContain('半身正面参考')
		expect(html).not.toContain('refs/xia-base.png')
		expect(html).not.toContain('ch01')
		expect(html).not.toContain('ch02')
		expect(html).toContain('第 1 章')
	})

	it('keeps leftover open-schema keys inside a collapsed 其他信息 disclosure without raw English keys', () => {
		const html = renderToStaticMarkup(
			createElement(OtherFields, {
				entry: {
					name: '旧码头',
					signatureMove: '撑伞回头',
					variants: [{ id: 'fog', description: '大雾清晨' }],
				},
				omit: ['name'],
			}),
		)

		// 其余键收进「其他信息」折叠区，正文仍在 DOM 里（默认收起）
		expect(html).toContain('其他信息')
		expect(html).toContain('大雾清晨')
		// 未知键人性化，绝不出现原始 camelCase
		expect(html).not.toContain('signatureMove')
		expect(html).toContain('Signature move')
		// id 不作为标签展示
		expect(html).not.toContain('<dt>ID</dt>')
		expect(html).not.toContain('>id</dt>')
	})

	it('formats chapter-valued keys in 其他信息 as ordinals, never raw ids', () => {
		const html = renderToStaticMarkup(
			createElement(OtherFields, {
				entry: { firstSeenChapter: 'ch03' },
			}),
		)

		expect(html).toContain('首次出场')
		expect(html).toContain('第 3 章')
		expect(html).not.toContain('ch03')
	})

	it('humanizes unknown keys and keeps localized labels for known keys', () => {
		expect(labelFor('personality')).toBe('性格')
		expect(labelFor('firstSeenChapter')).toBe('首次出场')
		expect(labelFor('someNewField')).toBe('Some new field')
		expect(labelFor('snake_case_key')).toBe('Snake case key')
	})
})
