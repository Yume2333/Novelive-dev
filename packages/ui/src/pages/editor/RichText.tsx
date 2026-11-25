import type { WorkSettings } from '@novelive/format/model'
import { Clock3, Gauge } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Tooltip } from '../../components/Extended'
import { scoped } from '../../i18n'
import { parseRich } from './sentence-lines'

const t = scoped('editor')

function segStyle(
	mark: string,
	base: 'stage' | 'list',
	customMarks: WorkSettings['customMarks'],
): CSSProperties | undefined {
	const accent =
		base === 'stage' ? 'var(--stage-accent)' : 'var(--color-primary)'
	switch (mark) {
		case 'em':
			return { color: accent, fontWeight: 600 }
		case 'b':
			return { fontWeight: 800 }
		case 'dim':
			return { opacity: 0.55 }
		case 'whisper':
			return { opacity: 0.72, fontSize: '0.88em' }
		case 'shout':
			return { fontWeight: 800, fontSize: '1.2em', letterSpacing: '0.04em' }
		case 'glitch':
			return {
				display: 'inline-block',
				transform: 'skewX(-6deg)',
				textShadow: `1px 0 color-mix(in srgb, var(--color-error) 80%, transparent), -1px 0 color-mix(in srgb, ${accent} 80%, transparent)`,
			}
		case 'hl':
			return {
				background:
					base === 'stage'
						? 'color-mix(in srgb, var(--stage-accent) 28%, transparent)'
						: 'var(--color-tertiary-fixed)',
				padding: '0 3px',
				borderRadius: 'var(--radius-sm)',
			}
		default: {
			if (mark in customMarks) {
				return {
					background:
						base === 'stage'
							? 'color-mix(in srgb, var(--stage-text) 14%, transparent)'
							: 'var(--color-secondary-container)',
					borderBottom: `1px dashed ${accent}`,
					padding: '0 4px',
					borderRadius: 'var(--radius-sm)',
				}
			}
			return { textDecoration: 'underline dotted', textUnderlineOffset: 3 }
		}
	}
}

export function RichText({
	src,
	base = 'list',
	customMarks,
}: {
	src: string
	base?: 'stage' | 'list'
	customMarks: WorkSettings['customMarks']
}) {
	const iconColor =
		base === 'stage' ? 'var(--stage-accent)' : 'var(--color-outline)'
	return (
		<>
			{parseRich(src).map((s, i) => {
				const key = `${s.kind}-${i}`
				if (s.kind === 'text') return <span key={key}>{s.text}</span>
				if (s.kind === 'mark') {
					const isCustom = s.mark in customMarks
					const inner = s.text.includes('{') ? (
						<RichText src={s.text} base={base} customMarks={customMarks} />
					) : (
						s.text
					)
					const styled = (
						<span key={key} style={segStyle(s.mark, base, customMarks)}>
							{inner}
						</span>
					)
					if (isCustom)
						return (
							<Tooltip key={key} text={t('「{{name}}」标记', { name: s.mark })}>
								{styled}
							</Tooltip>
						)
					return styled
				}
				if (s.kind === 'ruby')
					return (
						<ruby key={key}>
							{s.text}
							<rt
								style={{
									fontSize: '0.55em',
									color: iconColor,
									letterSpacing: '0.05em',
								}}
							>
								{s.reading}
							</rt>
						</ruby>
					)
				if (s.kind === 'wait')
					return (
						<Tooltip
							key={key}
							text={t('停顿 {{seconds}} 秒', { seconds: s.seconds })}
						>
							<Clock3
								size={13}
								aria-hidden="true"
								style={{
									color: iconColor,
									verticalAlign: '-2px',
									margin: '0 1px',
								}}
							/>
						</Tooltip>
					)
				// speed
				return (
					<Tooltip key={key} text={t('变速 ×{{factor}}', { factor: s.factor })}>
						<span style={{ borderBottom: `1px dotted ${iconColor}` }}>
							<Gauge
								size={12}
								aria-hidden="true"
								style={{
									color: iconColor,
									verticalAlign: '-2px',
									marginRight: 1,
								}}
							/>
							{s.text}
						</span>
					</Tooltip>
				)
			})}
		</>
	)
}
