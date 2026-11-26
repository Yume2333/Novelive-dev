import { Lightbulb, Mail, Moon, Sparkles, SunMedium, Waves } from 'lucide-react'
import type { CSSProperties } from 'react'
import styles from './GradientCover.module.css'

export type CoverMotif =
	| 'lighthouse'
	| 'letter'
	| 'wave'
	| 'star'
	| 'sun'
	| 'moon'

const motifIcons = {
	lighthouse: Lightbulb,
	letter: Mail,
	wave: Waves,
	star: Sparkles,
	sun: SunMedium,
	moon: Moon,
} as const

const motifs = [Lightbulb, Mail, Waves, Sparkles, SunMedium, Moon]

function hash(seed: string) {
	let value = 0
	for (const char of seed) value = (value * 31 + char.charCodeAt(0)) >>> 0
	return value
}

/** Palette index (0–5) derived from a stable seed; matches `data-palette`. */
export function coverPalette(seed: string) {
	return hash(seed) % 6
}

/** Gradient token for a seed — the same gradient GradientCover paints. */
export function coverGradient(seed: string) {
	return `var(--cover-${coverPalette(seed)})`
}

/** CSS-drawn book cover; palette and motif are derived from a stable seed. */
export function GradientCover({
	seed,
	title,
	author,
	compact,
	motif,
	gradient,
	style,
	className,
}: {
	seed: string
	title?: string
	author?: string
	compact?: boolean
	motif?: CoverMotif
	gradient?: string
	style?: CSSProperties
	className?: string
}) {
	const value = hash(seed)
	const Motif = motif
		? motifIcons[motif]
		: (motifs[value % motifs.length] ?? Lightbulb)
	const coverClass = compact
		? `${styles.cover} ${styles.compact}`
		: styles.cover
	return (
		<div
			className={className ? `${coverClass} ${className}` : coverClass}
			data-palette={coverPalette(seed)}
			aria-hidden="true"
			style={{ ...(gradient ? { background: gradient } : undefined), ...style }}
		>
			<div className={styles.spine} />
			<div className={styles.spineLine} />
			<div className={styles.gloss} />
			<div className={styles.frame}>
				<Motif
					size={compact ? 22 : 32}
					strokeWidth={1.8}
					className={styles.motif}
				/>
				{!compact && title && <div className={styles.title}>{title}</div>}
				{!compact && author && <div className={styles.author}>{author}</div>}
			</div>
		</div>
	)
}
