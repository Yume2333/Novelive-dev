import type { CommandOutput } from '@novelive/creator/contract'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Fields } from '../../packages/ui/src/pages/bible/BibleFields'
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
		expect(html).toContain('refs/xia-base.png')
		expect(html).toContain('还有 1 条变化')

		expect(html).not.toContain('描述：')
		expect(html).not.toContain('发色：')
		expect(html).not.toContain('瞳色：')
		expect(html).not.toContain('服装：')
		expect(html).not.toContain('说话人：')
		expect(html).not.toContain('ID：')
	})

	it('renders nested object and array fields structurally in generic Fields without key:value concatenation', () => {
		const html = renderToStaticMarkup(
			createElement(Fields, {
				entry: {
					name: '旧码头',
					variants: [{ id: 'fog', description: '大雾清晨' }],
					references: [{ path: 'refs/dock.png', description: '远景透视' }],
				},
			}),
		)

		expect(html).toContain('<dt>变体</dt>')
		expect(html).toContain('<dt>ID</dt><dd>fog</dd>')
		expect(html).toContain('<dt>描述</dt><dd>大雾清晨</dd>')
		expect(html).not.toContain('ID：fog')
		expect(html).not.toContain('描述：大雾清晨')
	})
})
