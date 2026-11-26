import { effectiveMarkCss } from '@novelive/player'
import { Sparkles } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Button } from '../../components/Button'
import { Banner } from '../../components/Extended'
import { Details } from '../../components/Feedback'
import { scoped } from '../../i18n'

const t = scoped('editor')

export interface MarkProposal {
	id: string
	name: string
	css: string
	perChar: boolean
}

/** 把 `color: red; font-weight: 700 !important;` 形的声明串解析成 CSSProperties。 */
function cssToProperties(css: string): CSSProperties {
	const properties: Record<string, string> = {}
	for (const entry of css.split(';')) {
		const colon = entry.indexOf(':')
		if (colon === -1) continue
		const key = entry.slice(0, colon).trim()
		const value = entry
			.slice(colon + 1)
			.trim()
			.replace(/\s*!\s*important$/i, '')
		if (!key || !value) continue
		const camel = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
		properties[camel] = value
	}
	return properties as CSSProperties
}

function MarkSample({ mark }: { mark: MarkProposal }) {
	const css = effectiveMarkCss(mark.name, mark.css)
	if (!css)
		return <span className="editor-mark-sample-empty">{t('无可渲染样式')}</span>
	const style = cssToProperties(css)
	const text = t('示例文字')
	if (mark.perChar) {
		// 逐字标记：每字一个 span。key 取「字符 + 该字符第几次出现」，由内容决定，
		// 不随渲染次序变化（示例文字本身静态）。
		const seen = new Map<string, number>()
		const glyphs = [...text].map((char) => {
			const occurrence = (seen.get(char) ?? 0) + 1
			seen.set(char, occurrence)
			return { key: `${char}·${occurrence}`, char }
		})
		return (
			<span className="editor-mark-sample" aria-hidden="true">
				{glyphs.map((glyph) => (
					<span key={glyph.key} style={style}>
						{glyph.char}
					</span>
				))}
			</span>
		)
	}
	return (
		<span className="editor-mark-sample" style={style} aria-hidden="true">
			{text}
		</span>
	)
}

export function MarkProposalBanner({
	mark,
	disabled,
	onAccept,
	onReject,
}: {
	mark: MarkProposal
	disabled: boolean
	onAccept(): void
	onReject(): void
}) {
	const css = effectiveMarkCss(mark.name, mark.css)
	return (
		<section aria-label={t('新标记提议')}>
			<Banner
				kind="warning"
				icon={Sparkles}
				action={
					<span className="editor-banner-actions">
						<Button
							size="sm"
							variant="ghost"
							disabled={disabled}
							onClick={onReject}
						>
							{t('拒绝标记')}
						</Button>
						<Button
							size="sm"
							variant="primary"
							disabled={disabled}
							onClick={onAccept}
						>
							{t('接受标记')}
						</Button>
					</span>
				}
			>
				<strong>{t('新标记：{{name}}', { name: mark.name })}</strong>{' '}
				<MarkSample mark={mark} />{' '}
				<span className="editor-mark-mode">
					{mark.perChar ? t('逐字') : t('整段')}
				</span>
			</Banner>
			{css ? (
				<Details summary={t('详细信息')} className="editor-mark-details">
					<code className="editor-mark-css">{css}</code>
				</Details>
			) : null}
		</section>
	)
}
