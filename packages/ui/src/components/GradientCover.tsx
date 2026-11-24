import {
	BookOpen,
	type LucideIcon,
	Mail,
	Moon,
	Sparkles,
	Sun,
	Waves,
} from 'lucide-react'
import styles from './GradientCover.module.css'

const motifs: LucideIcon[] = [Waves, Mail, Sparkles, Sun, Moon, BookOpen]

function hash(seed: string) {
	let value = 0
	for (const char of seed) value = (value * 31 + char.charCodeAt(0)) >>> 0
	return value
}

/** CSS-drawn book cover; palette and motif are derived from a stable seed. */
export function GradientCover({
	seed,
	title,
	compact,
}: {
	seed: string
	title?: string
	compact?: boolean
}) {
	const value = hash(seed)
	const Motif = motifs[value % motifs.length] ?? BookOpen
	return (
		<div
			className={compact ? `${styles.cover} ${styles.compact}` : styles.cover}
			data-palette={value % 6}
			aria-hidden="true"
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
			</div>
		</div>
	)
}
