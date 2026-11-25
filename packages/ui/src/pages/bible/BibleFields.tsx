import { msg, scoped } from '../../i18n'
import styles from './BiblePage.module.css'

const t = scoped('bible')

export const fieldLabels: Record<string, string> = {
	name: msg('名字'),
	originalName: msg('原文名字'),
	aliases: msg('别名'),
	major: msg('主要角色'),
	addresses: msg('称呼'),
	speakerId: msg('说话人'),
	identity: msg('身份'),
	personality: msg('性格'),
	speech: msg('说话方式'),
	appearance: msg('外貌'),
	description: msg('描述'),
	anchorFeatures: msg('锚点特征'),
	keyColors: msg('关键颜色'),
	hair: msg('发色'),
	eyes: msg('瞳色'),
	clothing: msg('服装'),
	costumes: msg('造型'),
	fromChapter: msg('起始章'),
	expressions: msg('表情'),
	references: msg('参考图'),
	reuse: msg('复用方式'),
	knows: msg('已知事实'),
	fact: msg('事实'),
	changes: msg('剧情变化'),
	chapterId: msg('章节'),
	field: msg('字段'),
	value: msg('内容'),
	firstSeenChapter: msg('首次出场'),
	revealedChapter: msg('揭示章节'),
	from: msg('角色'),
	to: msg('关联角色'),
	variants: msg('变体'),
	event: msg('事件'),
	storyTime: msg('故事时间'),
	plantedChapter: msg('埋设章节'),
	resolvedChapter: msg('回收章节'),
	narration: msg('旁白语气'),
	original: msg('原文写法'),
	written: msg('作品写法'),
	pronunciation: msg('注音'),
	category: msg('类别'),
	note: msg('备注'),
	path: msg('路径'),
	id: 'ID',
}

export function labelFor(key: string): string {
	return fieldLabels[key] ? t(fieldLabels[key]) : key
}

export function formatConflictValue(value: unknown): string {
	if (Array.isArray(value))
		return value.length ? value.map(formatConflictValue).join(t('；')) : t('无')
	if (value && typeof value === 'object')
		return Object.entries(value)
			.map(([key, item]) =>
				t('{{value}}：{{value2}}', {
					value: labelFor(key),
					value2: formatConflictValue(item),
				}),
			)
			.join(t('，'))
	if (typeof value === 'boolean') return value ? t('是') : t('否')
	return value === undefined || value === null ? t('未设置') : String(value)
}

function isPrimitive(
	value: unknown,
): value is string | number | boolean | null | undefined {
	return (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	)
}

export function StructuredValue({ value }: { value: unknown }) {
	if (typeof value === 'boolean') return <>{value ? t('是') : t('否')}</>
	if (value === undefined || value === null)
		return <span className={styles.muted}>{t('未设置')}</span>
	if (Array.isArray(value)) {
		if (!value.length) return <span className={styles.muted}>{t('无')}</span>
		if (value.every(isPrimitive)) {
			const seen = new Map<string, number>()
			return (
				<ul className={styles.chipList}>
					{value.map((item) => {
						const text =
							item === null || item === undefined
								? t('未设置')
								: typeof item === 'boolean'
									? item
										? t('是')
										: t('否')
									: String(item)
						const count = (seen.get(text) ?? 0) + 1
						seen.set(text, count)
						return (
							<li key={`${text}-${count}`} className={styles.chip}>
								{text}
							</li>
						)
					})}
				</ul>
			)
		}
		const seenObjects = new Map<string, number>()
		return (
			<ul className={styles.objectList}>
				{value.map((item) => {
					const raw = JSON.stringify(item) ?? 'item'
					const count = (seenObjects.get(raw) ?? 0) + 1
					seenObjects.set(raw, count)
					return (
						<li key={`${raw}-${count}`} className={styles.subCard}>
							<StructuredValue value={item} />
						</li>
					)
				})}
			</ul>
		)
	}
	if (typeof value === 'object') {
		const entries = Object.entries(value)
		if (!entries.length) return <span className={styles.muted}>{t('无')}</span>
		return (
			<dl className={styles.subFields}>
				{entries.map(([key, item]) => (
					<div key={key} className={styles.subFieldItem}>
						<dt>{labelFor(key)}</dt>
						<dd>
							<StructuredValue value={item} />
						</dd>
					</div>
				))}
			</dl>
		)
	}
	return <>{String(value)}</>
}

export function Fields({
	entry,
	omit = ['id', 'status', 'occurrences', 'conflict'],
}: {
	entry: Record<string, unknown>
	omit?: readonly string[]
}) {
	const items = Object.entries(entry).filter(([key]) => !omit.includes(key))
	if (!items.length) return null
	return (
		<dl className={styles.fields}>
			{items.map(([key, value]) => (
				<div
					key={key}
					className={
						Array.isArray(value) ||
						(value !== null && typeof value === 'object')
							? styles.fieldWide
							: undefined
					}
				>
					<dt>{labelFor(key)}</dt>
					<dd>
						<StructuredValue value={value} />
					</dd>
				</div>
			))}
		</dl>
	)
}
