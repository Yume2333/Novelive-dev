import {
	ArrowLeftRight,
	ChevronDown,
	CircleCheck,
	Clock,
	Eye,
	Languages,
	Maximize2,
	Mountain,
	Palette,
	RefreshCw,
	Sparkles,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useId, useState } from 'react'
import {
	Button,
	Card,
	Chip,
	Collapse,
	EmptyState,
	IconButton,
	Spinner,
	Tooltip,
} from '../../components'
import { msg, scoped } from '../../i18n'
import styles from './BiblePage.module.css'
import {
	assetResourceUrl,
	type BibleChange,
	type BibleCharacter,
	type BibleForeshadowing,
	type BibleGlossary,
	type BibleLocation,
	type BibleRelation,
	type BibleStyle,
	type BibleTimeline,
	chapterText,
	coverGradientVar,
	entryLayer,
	hashIndex,
	isWithinChapter,
	locationCandidateAssetIds,
	nameOrSlug,
	occurrenceText,
	type PreviewTarget,
	type ResolvedAssetMap,
} from './bibleHelpers'

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
}

/**
 * 未知键的人性化兜底：拆 camelCase / snake / kebab 为词并首字母大写，
 * 绝不把原始英文键名当界面文案。
 */
function humanizeKey(key: string): string {
	const words = key
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.trim()
	if (!words) return key
	return words.charAt(0).toUpperCase() + words.slice(1)
}

export function labelFor(key: string): string {
	return fieldLabels[key] ? t(fieldLabels[key]) : humanizeKey(key)
}

/** 结构化/冲突渲染共用的上下文：章节序号表 + 角色名查找 */
export type ValueCtx = {
	key?: string
	chapterOrder?: ReadonlyMap<string, number>
	characters?: readonly { id: string; name: string }[]
}

/** 内部实现细节永不渲染的键：任意深度一律舍弃（内部 id 与素材路径对创作者无意义） */
const hiddenValueKeys: ReadonlySet<string> = new Set(['id', 'path'])

/** 枚举值的人性化映射：后端枚举绝不原样上屏；未知枚举按原样透出（无法通用地翻译） */
const enumValueMap: Record<string, Record<string, string>> = {
	reuse: { reusable: msg('可复用'), 'one-off': msg('一次性') },
	status: { confirmed: msg('已确认'), candidate: msg('候选') },
}

/** 引用角色条目的键：值必须解析为角色名，绝不渲染原始 slug */
const characterRefKeys: ReadonlySet<string> = new Set([
	'speakerId',
	'from',
	'to',
])

function enumText(value: string, ctx?: ValueCtx): string | undefined {
	if (!ctx?.key) return undefined
	const mapped = enumValueMap[ctx.key]?.[value]
	return mapped ? t(mapped) : undefined
}

/** 角色引用解析：查得到给角色名；查不到返回 undefined，由调用方决定省略或兜底 */
function characterRefText(value: unknown, ctx?: ValueCtx): string | undefined {
	if (typeof value !== 'string' || !ctx?.key || !characterRefKeys.has(ctx.key))
		return undefined
	return ctx.characters?.find((item) => item.id === value)?.name
}

/** 参考图列表只展示描述：path 是内部细节，绝不渲染 */
function referenceDescriptions(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined
	const out: string[] = []
	for (const item of value) {
		if (!item || typeof item !== 'object') return undefined
		const description = (item as { description?: unknown }).description
		if (typeof description !== 'string') return undefined
		out.push(description)
	}
	return out
}

/** 值按章节展示（`第 N 章`）而非原始 id 的键 */
export const chapterKeys: ReadonlySet<string> = new Set([
	'firstSeenChapter',
	'revealedChapter',
	'plantedChapter',
	'resolvedChapter',
	'chapterId',
	'fromChapter',
])

export function formatConflictValue(value: unknown, ctx?: ValueCtx): string {
	if (typeof value === 'string' && ctx?.key && chapterKeys.has(ctx.key))
		return chapterText(value, ctx.chapterOrder) || value
	const enumMapped =
		typeof value === 'string' ? enumText(value, ctx) : undefined
	if (enumMapped) return enumMapped
	if (typeof value === 'string' && ctx?.key && characterRefKeys.has(ctx.key)) {
		// 角色引用要么解析为角色名，要么以通用名兜底，绝不透出原始 slug
		return characterRefText(value, ctx) ?? t('未命名角色')
	}
	if (ctx?.key === 'references') {
		const descriptions = referenceDescriptions(value)
		if (descriptions)
			return descriptions.length ? descriptions.join(t('；')) : t('无')
	}
	if (Array.isArray(value))
		return value.length
			? value.map((item) => formatConflictValue(item, ctx)).join(t('；'))
			: t('无')
	if (value && typeof value === 'object') {
		// id / path 是内部实现细节，任意深度一律舍弃；
		// 角色引用解析不出时整条省略，绝不渲染原始 slug
		return Object.entries(value)
			.filter(([key]) => !hiddenValueKeys.has(key))
			.map(([key, item]) => {
				if (
					characterRefKeys.has(key) &&
					typeof item === 'string' &&
					!characterRefText(item, { ...ctx, key })
				)
					return undefined
				return t('{{value}}：{{value2}}', {
					value: labelFor(key),
					value2: formatConflictValue(item, { ...ctx, key }),
				})
			})
			.filter((item): item is string => item !== undefined)
			.join(t('，'))
	}
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

function primitiveText(
	value: string | number | boolean | null | undefined,
	ctx?: ValueCtx,
): string {
	if (typeof value === 'boolean') return value ? t('是') : t('否')
	if (value === null || value === undefined) return t('未设置')
	if (typeof value === 'string' && ctx?.key && chapterKeys.has(ctx.key))
		return chapterText(value, ctx.chapterOrder) || value
	if (typeof value === 'string') {
		const mapped = enumText(value, ctx)
		if (mapped) return mapped
		if (ctx?.key && characterRefKeys.has(ctx.key))
			return characterRefText(value, ctx) ?? t('未命名角色')
	}
	return String(value)
}

function ChipList({ items }: { items: readonly string[] }) {
	const seen = new Map<string, number>()
	return (
		<ul className={styles.chipList}>
			{items.map((text) => {
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

export function StructuredValue({
	value,
	ctx,
}: {
	value: unknown
	ctx?: ValueCtx
}) {
	if (typeof value === 'boolean') return <>{value ? t('是') : t('否')}</>
	if (value === undefined || value === null)
		return <span className={styles.muted}>{t('未设置')}</span>
	if (typeof value === 'string' && ctx?.key && chapterKeys.has(ctx.key))
		return <>{chapterText(value, ctx.chapterOrder) || value}</>
	if (typeof value === 'string') {
		const mapped = enumText(value, ctx)
		if (mapped) return <>{mapped}</>
		if (ctx?.key && characterRefKeys.has(ctx.key))
			return <>{characterRefText(value, ctx) ?? t('未命名角色')}</>
	}
	if (ctx?.key === 'references') {
		// 参考图只展示描述：path 是内部实现细节，绝不上屏
		const descriptions = referenceDescriptions(value)
		if (descriptions)
			return descriptions.length ? (
				<ChipList items={descriptions} />
			) : (
				<span className={styles.muted}>{t('无')}</span>
			)
	}
	if (Array.isArray(value)) {
		if (!value.length) return <span className={styles.muted}>{t('无')}</span>
		if (value.every(isPrimitive))
			return <ChipList items={value.map((item) => primitiveText(item, ctx))} />
		const seenObjects = new Map<string, number>()
		return (
			<ul className={styles.objectList}>
				{value.map((item) => {
					const raw = JSON.stringify(item) ?? 'item'
					const count = (seenObjects.get(raw) ?? 0) + 1
					seenObjects.set(raw, count)
					return (
						<li key={`${raw}-${count}`} className={styles.subCard}>
							<StructuredValue value={item} ctx={ctx} />
						</li>
					)
				})}
			</ul>
		)
	}
	if (typeof value === 'object') {
		// id / path 是内部实现细节，任意深度一律舍弃；
		// 角色引用解析不出时整条省略，绝不渲染原始 slug
		const entries = Object.entries(value)
			.filter(([key]) => !hiddenValueKeys.has(key))
			.filter(
				([key, item]) =>
					!(
						characterRefKeys.has(key) &&
						typeof item === 'string' &&
						!characterRefText(item, { ...ctx, key })
					),
			)
		if (!entries.length) return <span className={styles.muted}>{t('无')}</span>
		return (
			<dl className={styles.subFields}>
				{entries.map(([key, item]) => (
					<div key={key} className={styles.subFieldItem}>
						<dt>{labelFor(key)}</dt>
						<dd>
							<StructuredValue value={item} ctx={{ ...ctx, key }} />
						</dd>
					</div>
				))}
			</dl>
		)
	}
	return <>{String(value)}</>
}

const otherFieldOmit = [
	'id',
	'status',
	'occurrences',
	'conflict',
	'layer',
	'scope',
	'path',
] as const

/** 未被策展处理的开放键统一收进默认折叠的「其他信息」 */
export function OtherFields({
	entry,
	omit = [],
	chapterOrder,
	characters,
}: {
	entry: Record<string, unknown>
	omit?: readonly string[]
	chapterOrder?: ReadonlyMap<string, number>
	characters?: readonly { id: string; name: string }[]
}) {
	const hidden = [...otherFieldOmit, ...omit]
	const items = Object.entries(entry).filter(
		([key, value]) => !hidden.includes(key) && value !== undefined,
	)
	if (!items.length) return null
	return (
		<OtherFieldsDisclosure
			items={items}
			chapterOrder={chapterOrder}
			characters={characters}
		/>
	)
}

function OtherFieldsDisclosure({
	items,
	chapterOrder,
	characters,
}: {
	items: [string, unknown][]
	chapterOrder?: ReadonlyMap<string, number>
	characters?: readonly { id: string; name: string }[]
}) {
	const [open, setOpen] = useState(false)
	const id = useId()
	return (
		<div className={styles.otherInfo}>
			<button
				type="button"
				className={styles.otherInfoToggle}
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronDown
					aria-hidden="true"
					size={14}
					strokeWidth={1.8}
					className="nl-chevron"
					data-open={open ? 'true' : 'false'}
				/>
				{t('其他信息')}
			</button>
			<Collapse open={open}>
				<dl id={id} className={styles.fields}>
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
								<StructuredValue
									value={value}
									ctx={{ key, chapterOrder, characters }}
								/>
							</dd>
						</div>
					))}
				</dl>
			</Collapse>
		</div>
	)
}

/** 状态标记统一约定：候选需要处理用强调，已确认安静展示 */
export function StatusChip({ status }: { status: string }) {
	if (status === 'confirmed') return <Chip>{t('已确认')}</Chip>
	return <Chip active>{t('候选')}</Chip>
}

/** 唯一的问 Agent 入口：卡片头部常显，列表行内由 row-actions 悬停露出 */
export function AskAgentButton({
	onAskAgent,
	entryId,
	label,
}: {
	onAskAgent: ((entryId: string, label: string) => void) | undefined
	entryId: string
	label: string
}) {
	if (!onAskAgent) return null
	return (
		<IconButton
			icon={Sparkles}
			label={t('问 Agent 修改')}
			size={28}
			onClick={() => onAskAgent(entryId, label)}
		/>
	)
}

type Occurrence = {
	chapterId: string
	paragraphId: string
	quote: string
}

function occurrencesOfEntry(entry: unknown): Occurrence[] {
	const list = (entry as { occurrences?: Occurrence[] })?.occurrences
	return Array.isArray(list) ? list : []
}

/** 出现位置展开区：只渲染展开内容，供整行跨列铺开（术语表）等容器使用 */
export function OccurrenceList({
	entry,
	chapterOrder,
}: {
	entry: unknown
	chapterOrder?: ReadonlyMap<string, number>
}) {
	const occurrences = occurrencesOfEntry(entry)
	if (!occurrences.length)
		return <p className={styles.muted}>{t('暂无原文匹配')}</p>
	return (
		<ul className={styles.occurrencesList}>
			{occurrences.map(({ chapterId, paragraphId, quote }) => (
				<li
					key={`${chapterId}/${paragraphId}`}
					className={styles.occurrencesItem}
				>
					<strong>
						{occurrenceText(chapterId, paragraphId, chapterOrder)}
					</strong>
					<p>{quote}</p>
				</li>
			))}
		</ul>
	)
}

/** 出现位置折叠区：行内就地展开（卡片等宽容器用；窄表格请用 OccurrenceRow） */
export function Occurrences({
	entry,
	chapterOrder,
}: {
	entry: unknown
	chapterOrder?: ReadonlyMap<string, number>
}) {
	const [open, setOpen] = useState(false)
	const id = useId()
	const count = occurrencesOfEntry(entry).length
	return (
		<div>
			<button
				type="button"
				className={styles.disclosure}
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((value) => !value)}
			>
				{t('出现位置（{{length}}）', { length: count })}
			</button>
			<Collapse open={open}>
				<div id={id}>
					<OccurrenceList entry={entry} chapterOrder={chapterOrder} />
				</div>
			</Collapse>
		</div>
	)
}

/**
 * 术语表用出现位置开关：放进「原文出处」单元格。
 * 展开的内容由 GlossaryEntryRows 在表格下一行整行铺开，
 * 行高不会被引文撑爆。
 */
export function OccurrenceToggle({
	entry,
	open,
	contentId,
	onToggle,
}: {
	entry: unknown
	open: boolean
	contentId: string
	onToggle: () => void
}) {
	const count = occurrencesOfEntry(entry).length
	return (
		<button
			type="button"
			className={styles.disclosure}
			aria-expanded={open}
			aria-controls={contentId}
			onClick={onToggle}
		>
			{t('出现位置（{{length}}）', { length: count })}
		</button>
	)
}

/**
 * 展开的出现位置整行（colSpan 铺满表格宽度）；未展开时不渲染。
 */
export function OccurrenceExpandedRow({
	entry,
	open,
	contentId,
	chapterOrder,
	colSpan,
}: {
	entry: unknown
	open: boolean
	contentId: string
	chapterOrder?: ReadonlyMap<string, number>
	colSpan: number
}) {
	if (!open) return null
	return (
		<tr className={styles.glossaryOccurrenceRow}>
			<td colSpan={colSpan} className={styles.glossaryOccurrenceExpanded}>
				<div id={contentId}>
					<OccurrenceList entry={entry} chapterOrder={chapterOrder} />
				</div>
			</td>
		</tr>
	)
}

/** 来源层级标记：系列 / 卷 / 作品（下级同名条目整条覆盖上级） */
export function LayerChip({ entry }: { entry: unknown }) {
	const layer = entryLayer(entry)
	if (layer === undefined) return null
	const label =
		layer === 'series' ? t('系列') : layer === 'volume' ? t('卷') : t('作品')
	return (
		<Tooltip text={t('下级同名条目会整条覆盖这一条')}>
			<Chip>{label}</Chip>
		</Tooltip>
	)
}

function changeRows(
	list: readonly BibleChange[],
	chapterCutoff: number | undefined,
	chapterOrder: ReadonlyMap<string, number> | undefined,
) {
	const seen = new Map<string, number>()
	return list.map((change) => {
		const base = `${change.chapterId}-${change.field}-${change.value}`
		const count = (seen.get(base) ?? 0) + 1
		seen.set(base, count)
		return (
			<div key={`${base}-${count}`} className={styles.changeRow}>
				<Chip
					active={isWithinChapter(
						change.chapterId,
						chapterCutoff,
						chapterOrder,
					)}
				>
					{chapterText(change.chapterId, chapterOrder)}
				</Chip>
				<span className={styles.changeField}>{labelFor(change.field)}</span>
				<strong>{change.value}</strong>
			</div>
		)
	})
}

/** 设定变化列表；从第 3 条起平滑折叠 */
export function ChangeList({
	changes,
	chapterCutoff,
	chapterOrder,
}: {
	changes?: readonly BibleChange[]
	chapterCutoff?: number
	chapterOrder?: ReadonlyMap<string, number>
}) {
	const [open, setOpen] = useState(false)
	if (!changes?.length) return null
	const head = changes.slice(0, 2)
	const tail = changes.slice(2)
	return (
		<>
			<div className={styles.changeList}>
				{changeRows(head, chapterCutoff, chapterOrder)}
			</div>
			{tail.length > 0 && (
				<>
					<Collapse open={open}>
						<div className={styles.changeList}>
							{changeRows(tail, chapterCutoff, chapterOrder)}
						</div>
					</Collapse>
					<button
						type="button"
						className={styles.collapseToggle}
						aria-expanded={open}
						onClick={() => setOpen((value) => !value)}
					>
						<ChevronDown
							aria-hidden="true"
							size={14}
							strokeWidth={1.8}
							className="nl-chevron"
							data-open={open ? 'true' : 'false'}
						/>
						{open
							? t('收起')
							: t('还有 {{count}} 条变化', { count: tail.length })}
					</button>
				</>
			)}
		</>
	)
}

/** 超过约 4 行的长描述：默认夹住，给出 展开/收起 开关 */
const clampThreshold = 160

export function ClampedText({
	text,
	className,
}: {
	text: string
	className?: string
}) {
	const [expanded, setExpanded] = useState(false)
	const long =
		text.length > clampThreshold || text.trim().split('\n').length > 4
	const classes = [className, long && !expanded && styles.clamped]
		.filter(Boolean)
		.join(' ')
	return (
		<div className={styles.clampWrap}>
			<p className={classes}>{text}</p>
			{long && (
				<button
					type="button"
					className={styles.clampToggle}
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? t('收起') : t('展开')}
				</button>
			)}
		</div>
	)
}

const handledLocationKeys = [
	'name',
	'description',
	'variants',
	'references',
	'changes',
	'firstSeenChapter',
	'revealedChapter',
] as const

export function LocationCard({
	location,
	focused,
	chapterCutoff,
	chapterOrder,
	resolvedAssets,
	assetVersions,
	regenKeys,
	occurrences,
	onPreview,
	onRegen,
	onAskAgent,
}: {
	location: BibleLocation
	focused?: boolean
	chapterCutoff?: number
	chapterOrder?: ReadonlyMap<string, number>
	resolvedAssets?: ResolvedAssetMap
	assetVersions?: Readonly<Record<string, number>>
	regenKeys?: Readonly<Record<string, boolean>>
	occurrences?: ReactNode
	onPreview?: (target: PreviewTarget) => void
	onRegen?: (assetId: string, label: string) => void
	onAskAgent?: (entryId: string, label: string) => void
}) {
	const candidates = locationCandidateAssetIds(location)
	const drawnId = candidates.find((id) => resolvedAssets?.[id])
	const primaryAssetId = drawnId ?? candidates[0] ?? location.id
	const drawn = drawnId !== undefined
	const version = assetVersions?.[primaryAssetId]
	const cachePath = resolvedAssets?.[primaryAssetId] ?? undefined
	const imgUrl = drawn ? assetResourceUrl(cachePath, version) : undefined
	const isRegen = Boolean(regenKeys?.[primaryAssetId])
	const variants = location.variants ?? []
	const referencePreview =
		location.references?.[0]?.description ?? location.description
	const beforeFirst =
		Boolean(location.firstSeenChapter) &&
		!isWithinChapter(location.firstSeenChapter, chapterCutoff, chapterOrder)
	const openPreview = () => {
		onPreview?.({
			kind: 'location',
			locId: location.id,
			assetId: primaryAssetId,
			title: location.name,
			description: location.description,
			variants,
		})
	}

	return (
		<article
			className={`${styles.card} ${beforeFirst ? styles.charDimmed : ''}`}
			id={`bible-entry-${location.id}`}
			data-focused={focused || undefined}
		>
			<header className={styles.cardHead}>
				<Mountain
					aria-hidden="true"
					size={17}
					strokeWidth={1.8}
					className={styles.relationIcon}
				/>
				<h3>{location.name}</h3>
				<StatusChip status={location.status} />
				<LayerChip entry={location} />
				{location.firstSeenChapter && (
					<span className={styles.muted}>
						{t('首次出现：{{chapter}}', {
							chapter: chapterText(location.firstSeenChapter, chapterOrder),
						})}
					</span>
				)}
				{location.revealedChapter && (
					<span className={styles.muted}>
						{t('揭示章节')}{' '}
						{chapterText(location.revealedChapter, chapterOrder)}
					</span>
				)}
				<span className={styles.cardActions}>
					<AskAgentButton
						onAskAgent={onAskAgent}
						entryId={location.id}
						label={location.name}
					/>
				</span>
			</header>

			{location.conflict && (
				<p className={styles.conflictBox}>{location.conflict}</p>
			)}

			{/* biome-ignore lint/a11y/useSemanticElements: 复合媒体块内含预览/重绘子按钮，不能用原生 button 嵌套 */}
			<div
				className={`${styles.mediaCard} ${styles.locationPreview} ${imgUrl ? styles.locationPreviewHasImg : ''}`}
				role="button"
				tabIndex={0}
				onClick={openPreview}
				onKeyDown={(event) => {
					if (
						event.target === event.currentTarget &&
						(event.key === 'Enter' || event.key === ' ')
					) {
						event.preventDefault()
						openPreview()
					}
				}}
			>
				{imgUrl && (
					<>
						<img
							className={styles.locationPreviewImg}
							src={imgUrl}
							alt={location.name}
						/>
						<span className={styles.locationPreviewScrim} aria-hidden="true" />
					</>
				)}
				<div className={styles.locationPreviewInfo}>
					<div
						className={`label-caps label-caps-zh ${styles.locationPreviewMeta}`}
					>
						{variants.length
							? t('场景基准图 · {{count}} 个时段变体', {
									count: variants.length,
								})
							: t('场景基准图')}
					</div>
					<div className={styles.locationPreviewRef}>{referencePreview}</div>
				</div>
				{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: 仅阻止冒泡到外层预览触发层，本身非交互控件 */}
				<div
					className={styles.locationMediaActions}
					onClick={(event) => event.stopPropagation()}
				>
					<div className={styles.mediaActions}>
						<Button size="sm" icon={Maximize2} onClick={openPreview}>
							{t('预览')}
						</Button>
						{drawn && onRegen && (
							<Button
								size="sm"
								icon={RefreshCw}
								loading={isRegen}
								onClick={() => onRegen(primaryAssetId, location.name)}
							>
								{t('重新生成')}
							</Button>
						)}
					</div>
				</div>
				{isRegen && (
					<div className={styles.shimmerOverlay}>
						<div className={styles.shimmerContent}>
							<Spinner size={14} />
							<span className={`ink-shimmer ${styles.shimmerText}`}>
								{t('正在生成…')}
							</span>
						</div>
					</div>
				)}
			</div>

			<ClampedText className={styles.detailText} text={location.description} />

			{variants.length > 0 && (
				<div className={styles.variantChips}>
					{variants.map((variant) => {
						const text = nameOrSlug(variant)
						const tip = variant.description?.trim()
						// 描述全文已在 chip 上时不重复浮层；chip 为人性化缩写时浮层给描述
						if (!tip || tip === text)
							return <Chip key={variant.id}>{text}</Chip>
						return (
							<Tooltip key={variant.id} text={tip}>
								<Chip>{text}</Chip>
							</Tooltip>
						)
					})}
				</div>
			)}

			<ChangeList
				changes={location.changes}
				chapterCutoff={chapterCutoff}
				chapterOrder={chapterOrder}
			/>

			<OtherFields
				entry={location as unknown as Record<string, unknown>}
				omit={handledLocationKeys}
				chapterOrder={chapterOrder}
			/>

			{occurrences}
		</article>
	)
}

const handledRelationKeys = [
	'from',
	'to',
	'description',
	'changes',
	'revealedChapter',
] as const

export function RelationCard({
	relation,
	characters,
	focused,
	chapterCutoff,
	chapterOrder,
	occurrences,
	onAskAgent,
}: {
	relation: BibleRelation
	characters: readonly BibleCharacter[]
	focused?: boolean
	chapterCutoff?: number
	chapterOrder?: ReadonlyMap<string, number>
	occurrences?: ReactNode
	onAskAgent?: (entryId: string, label: string) => void
}) {
	const fromName =
		characters.find((item) => item.id === relation.from)?.name ??
		t('未命名角色')
	const toName =
		characters.find((item) => item.id === relation.to)?.name ?? t('未命名角色')
	const label = `${fromName} / ${toName}`
	return (
		<article
			className={styles.card}
			id={`bible-entry-${relation.id}`}
			data-focused={focused || undefined}
		>
			<header className={styles.cardHead}>
				<span className={styles.relationHead}>
					<span className={styles.relationName}>{fromName}</span>
					<ArrowLeftRight
						aria-hidden="true"
						size={16}
						strokeWidth={1.8}
						className={styles.relationIcon}
					/>
					<span className={styles.relationName}>{toName}</span>
				</span>
				<StatusChip status={relation.status} />
				<LayerChip entry={relation} />
				{relation.revealedChapter && (
					<span className={styles.muted}>
						{t('揭示章节')}{' '}
						{chapterText(relation.revealedChapter, chapterOrder)}
					</span>
				)}
				<span className={styles.cardActions}>
					<AskAgentButton
						onAskAgent={onAskAgent}
						entryId={relation.id}
						label={label}
					/>
				</span>
			</header>

			{relation.conflict && (
				<p className={styles.conflictBox}>{relation.conflict}</p>
			)}

			<ClampedText className={styles.detailText} text={relation.description} />

			<ChangeList
				changes={relation.changes}
				chapterCutoff={chapterCutoff}
				chapterOrder={chapterOrder}
			/>

			<OtherFields
				entry={relation as unknown as Record<string, unknown>}
				omit={handledRelationKeys}
				chapterOrder={chapterOrder}
				characters={characters}
			/>

			{occurrences}
		</article>
	)
}

export function TimelineView({
	entries,
	focused,
	chapterCutoff,
	chapterOrder,
	renderOccurrences,
	onAskAgent,
}: {
	entries: readonly BibleTimeline[]
	focused?: string
	chapterCutoff?: number
	chapterOrder?: ReadonlyMap<string, number>
	renderOccurrences?: (entry: BibleTimeline) => ReactNode
	onAskAgent?: (entryId: string, label: string) => void
}) {
	const shown = entries.filter((entry) =>
		isWithinChapter(entry.chapterId, chapterCutoff, chapterOrder),
	)
	if (!shown.length)
		return (
			<Card>
				<EmptyState
					icon={Clock}
					title={t('这之前没有事件')}
					text={t('当前章节范围内还没有时间线索引。')}
				/>
			</Card>
		)
	return (
		<Card className={styles.listCard}>
			<ul className={styles.listReset}>
				{shown.map((entry) => (
					<li
						key={entry.id}
						id={`bible-entry-${entry.id}`}
						data-focused={focused === entry.id || undefined}
						className={styles.listRowDivider}
					>
						<div className={`hover-row ${styles.listRow}`}>
							<Clock
								aria-hidden="true"
								size={15}
								strokeWidth={1.8}
								className={styles.foreshadowIcon}
							/>
							{entry.storyTime && (
								<span
									className={`label-caps label-caps-zh ${styles.timelineTime}`}
								>
									{entry.storyTime}
								</span>
							)}
							<span className={styles.listRowMain}>{entry.event}</span>
							<Chip>{chapterText(entry.chapterId, chapterOrder)}</Chip>
							{entry.status !== 'confirmed' && <Chip active>{t('候选')}</Chip>}
							{onAskAgent && (
								<span className={`row-actions ${styles.rowAskBtn}`}>
									<AskAgentButton
										onAskAgent={onAskAgent}
										entryId={entry.id}
										label={entry.event}
									/>
								</span>
							)}
						</div>
						{renderOccurrences?.(entry)}
					</li>
				))}
			</ul>
		</Card>
	)
}

export function ForeshadowingView({
	entries,
	focused,
	chapterCutoff,
	chapterOrder,
	renderOccurrences,
	onAskAgent,
}: {
	entries: readonly BibleForeshadowing[]
	focused?: string
	chapterCutoff?: number
	chapterOrder?: ReadonlyMap<string, number>
	renderOccurrences?: (entry: BibleForeshadowing) => ReactNode
	onAskAgent?: (entryId: string, label: string) => void
}) {
	const shown = entries.filter((entry) =>
		isWithinChapter(entry.plantedChapter, chapterCutoff, chapterOrder),
	)
	if (!shown.length)
		return (
			<Card>
				<EmptyState
					icon={Eye}
					title={t('这之前还没有伏笔')}
					text={t('当前章节范围内还没有埋下的伏笔。')}
				/>
			</Card>
		)
	return (
		<Card className={styles.listCard}>
			<ul className={styles.listReset}>
				{shown.map((entry) => {
					const closed =
						Boolean(entry.resolvedChapter) &&
						isWithinChapter(entry.resolvedChapter, chapterCutoff, chapterOrder)
					const resolved = chapterText(entry.resolvedChapter, chapterOrder)
					const meta = entry.resolvedChapter
						? closed
							? t('{{chapter}} 已回收', { chapter: resolved })
							: t('{{chapter}} 回收', { chapter: resolved })
						: t('仍开着')
					const Icon = closed ? CircleCheck : Eye
					return (
						<li
							key={entry.id}
							id={`bible-entry-${entry.id}`}
							data-focused={focused === entry.id || undefined}
							className={styles.listRowDivider}
						>
							<div className={`hover-row ${styles.listRow}`}>
								<Icon
									aria-hidden="true"
									size={15}
									strokeWidth={1.8}
									className={
										closed
											? styles.foreshadowIconResolved
											: styles.foreshadowIcon
									}
								/>
								<span className={styles.listRowMain}>{entry.description}</span>
								<span className={styles.listRowMeta}>
									{t('埋于 {{chapter}}', {
										chapter: chapterText(entry.plantedChapter, chapterOrder),
									})}
									{' · '}
									{meta}
								</span>
								{entry.status !== 'confirmed' && (
									<Chip active>{t('候选')}</Chip>
								)}
								{onAskAgent && (
									<span className={`row-actions ${styles.rowAskBtn}`}>
										<AskAgentButton
											onAskAgent={onAskAgent}
											entryId={entry.id}
											label={entry.description}
										/>
									</span>
								)}
							</div>
							{renderOccurrences?.(entry)}
						</li>
					)
				})}
			</ul>
		</Card>
	)
}

const handledStyleKeys = ['description', 'narration', 'references'] as const

function StyleRefThumb({ path, alt }: { path: string; alt: string }) {
	const [failed, setFailed] = useState(false)
	const url = assetResourceUrl(path)
	const thumbStyle = {
		'--styleref-bg': coverGradientVar(path),
	} as CSSProperties
	return (
		<div className={styles.styleRefThumb} style={thumbStyle}>
			{url && !failed && (
				<img
					className={styles.styleRefImg}
					src={url}
					alt={alt}
					loading="lazy"
					onError={() => setFailed(true)}
				/>
			)}
		</div>
	)
}

export function StylesView({
	entries,
	focused,
	chapterOrder,
	renderOccurrences,
	onPreview,
	onAskAgent,
}: {
	entries: readonly BibleStyle[]
	focused?: string
	chapterOrder?: ReadonlyMap<string, number>
	renderOccurrences?: (entry: BibleStyle) => ReactNode
	onPreview?: (target: PreviewTarget) => void
	onAskAgent?: (entryId: string, label: string) => void
}) {
	if (!entries.length)
		return (
			<Card>
				<EmptyState
					icon={Palette}
					title={t('暂无风格设定')}
					text={t('综合提取的画风与旁白设定会列在这里。')}
				/>
			</Card>
		)
	return (
		<>
			{entries.map((style) => (
				<article
					key={style.id}
					className={styles.card}
					id={`bible-entry-${style.id}`}
					data-focused={focused === style.id || undefined}
				>
					<header className={styles.cardHead}>
						<StatusChip status={style.status} />
						<LayerChip entry={style} />
						<span className={styles.cardActions}>
							<AskAgentButton
								onAskAgent={onAskAgent}
								entryId={style.id}
								label={t('风格')}
							/>
						</span>
					</header>

					{style.conflict && (
						<p className={styles.conflictBox}>{style.conflict}</p>
					)}

					<div className={styles.styleBlocks}>
						<div className={styles.styleBlock}>
							<div className={`label-caps label-caps-zh ${styles.styleLabel}`}>
								{t('画风 / 主视觉参考')}
							</div>
							<ClampedText
								className={styles.styleBody}
								text={style.description}
							/>
						</div>
						{style.narration && (
							<div className={styles.styleBlock}>
								<div
									className={`label-caps label-caps-zh ${styles.styleLabel}`}
								>
									{t('旁白语气')}
								</div>
								<ClampedText
									className={styles.styleBody}
									text={style.narration}
								/>
							</div>
						)}
						{style.references && style.references.length > 0 && (
							<div className={styles.styleBlock}>
								<div
									className={`label-caps label-caps-zh ${styles.styleLabel}`}
								>
									{t('画风参考')}
								</div>
								<div className={styles.styleRefs}>
									{(() => {
										const seen = new Map<string, number>()
										return style.references?.map((ref, index) => {
											const base = `${ref.path}-${ref.description}`
											const count = (seen.get(base) ?? 0) + 1
											seen.set(base, count)
											return (
												<button
													key={`${base}-${count}`}
													type="button"
													className={`${styles.mediaCard} ${styles.styleRefCard} nl-card-interactive`}
													onClick={() =>
														onPreview?.({
															kind: 'styleRef',
															styleId: style.id,
															index,
															title: ref.description,
															path: ref.path,
															gradientIndex: hashIndex(ref.path, 6),
														})
													}
												>
													<StyleRefThumb
														path={ref.path}
														alt={ref.description}
													/>
													<div className={styles.styleRefTitle}>
														{ref.description}
													</div>
												</button>
											)
										})
									})()}
								</div>
							</div>
						)}
					</div>

					<OtherFields
						entry={style as unknown as Record<string, unknown>}
						omit={handledStyleKeys}
						chapterOrder={chapterOrder}
					/>

					{renderOccurrences?.(style)}
				</article>
			))}
		</>
	)
}

/**
 * 单条术语的两行：主行放字段与「原文出处」开关，
 * 展开的引文列表整行铺开，不影响主行行高。
 */
function GlossaryEntryRows({
	entry,
	focused,
	chapterOrder,
	colSpan,
	onAskAgent,
}: {
	entry: BibleGlossary
	focused?: boolean
	chapterOrder?: ReadonlyMap<string, number>
	colSpan: number
	onAskAgent?: (entryId: string, label: string) => void
}) {
	const [open, setOpen] = useState(false)
	const contentId = useId()
	return (
		<tbody>
			<tr
				id={`bible-entry-${entry.id}`}
				data-focused={focused || undefined}
				className="hover-row"
			>
				<td>{entry.original}</td>
				<th scope="row">
					{entry.written}
					{entry.status !== 'confirmed' && <Chip active>{t('候选')}</Chip>}
				</th>
				<td>{entry.pronunciation || '—'}</td>
				<td>
					<Chip>{entry.category}</Chip>
				</td>
				<td>{entry.note || '—'}</td>
				<td>
					<div className={styles.glossarySourceCell}>
						<OccurrenceToggle
							entry={entry}
							open={open}
							contentId={contentId}
							onToggle={() => setOpen((value) => !value)}
						/>
						{onAskAgent && (
							<span className={`row-actions ${styles.rowAskBtn}`}>
								<AskAgentButton
									onAskAgent={onAskAgent}
									entryId={entry.id}
									label={entry.written}
								/>
							</span>
						)}
					</div>
				</td>
			</tr>
			<OccurrenceExpandedRow
				entry={entry}
				open={open}
				contentId={contentId}
				chapterOrder={chapterOrder}
				colSpan={colSpan}
			/>
		</tbody>
	)
}

export function GlossaryTable({
	entries,
	focused,
	chapterOrder,
	onAskAgent,
}: {
	entries: readonly BibleGlossary[]
	focused?: string
	chapterOrder?: ReadonlyMap<string, number>
	onAskAgent?: (entryId: string, label: string) => void
}) {
	if (!entries.length)
		return (
			<Card>
				<EmptyState
					icon={Languages}
					title={t('还没有术语')}
					text={t('综合提取的专名会列在这里。')}
				/>
			</Card>
		)
	const colCount = 6
	return (
		<Card className={styles.glossaryCard}>
			<p className={styles.glossaryNote}>
				{t('角色名和地名只记在角色和地点条目里。')}
			</p>
			<div className={`nl-scroll-hidden ${styles.glossaryTableWrap}`}>
				<table className={styles.glossaryTable}>
					<thead>
						<tr>
							<th scope="col">{t('原文写法')}</th>
							<th scope="col">{t('作品写法')}</th>
							<th scope="col">{t('注音')}</th>
							<th scope="col">{t('类别')}</th>
							<th scope="col">{t('备注')}</th>
							<th scope="col">{t('原文出处')}</th>
						</tr>
					</thead>
					{entries.map((entry) => (
						<GlossaryEntryRows
							key={entry.id}
							entry={entry}
							focused={focused === entry.id}
							chapterOrder={chapterOrder}
							colSpan={colCount}
							onAskAgent={onAskAgent}
						/>
					))}
				</table>
			</div>
		</Card>
	)
}

/** 开放条目字段的类型守卫小工具：只认运行时验证过的形状 */
function asText(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined
}

function asTextList(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value.filter((item): item is string => typeof item === 'string')
}

function asDescribedList(
	value: unknown,
): { id: string; description?: string }[] {
	if (!Array.isArray(value)) return []
	const out: { id: string; description?: string }[] = []
	for (const item of value) {
		if (!item || typeof item !== 'object' || !('id' in item)) continue
		const raw = item as { id: unknown; description?: unknown }
		if (typeof raw.id !== 'string') continue
		out.push({
			id: raw.id,
			description:
				typeof raw.description === 'string' ? raw.description : undefined,
		})
	}
	return out
}

function asChangeList(value: unknown): BibleChange[] {
	if (!Array.isArray(value)) return []
	const out: BibleChange[] = []
	for (const item of value) {
		if (!item || typeof item !== 'object') continue
		const raw = item as {
			chapterId?: unknown
			field?: unknown
			value?: unknown
		}
		if (typeof raw.chapterId !== 'string' || typeof raw.field !== 'string')
			continue
		out.push({
			chapterId: raw.chapterId,
			field: raw.field,
			value:
				typeof raw.value === 'string' ? raw.value : String(raw.value ?? ''),
		} as BibleChange)
	}
	return out
}

function asAddressList(
	value: unknown,
): { speakerId?: string; name?: string }[] {
	if (!Array.isArray(value)) return []
	const out: { speakerId?: string; name?: string }[] = []
	for (const item of value) {
		if (!item || typeof item !== 'object') continue
		const raw = item as { speakerId?: unknown; name?: unknown }
		out.push({
			speakerId: typeof raw.speakerId === 'string' ? raw.speakerId : undefined,
			name: typeof raw.name === 'string' ? raw.name : undefined,
		})
	}
	return out
}

/**
 * 候选抽屉里的策展字段渲染：每类条目只展示策划相关字段，
 * 其余开放键收进折叠的「其他信息」，绝不出现内部 id。
 */
export function EntryDetails({
	kind,
	entry,
	chapterOrder,
	characters,
}: {
	kind:
		| 'character'
		| 'location'
		| 'relation'
		| 'timeline'
		| 'foreshadowing'
		| 'style'
		| 'glossary'
	entry: Record<string, unknown>
	chapterOrder?: ReadonlyMap<string, number>
	characters?: readonly { id: string; name: string }[]
}) {
	const curated: string[] = []
	const rows: ReactNode[] = []
	const characterName = (id: unknown): string => {
		if (typeof id !== 'string') return t('未命名角色')
		return characters?.find((item) => item.id === id)?.name ?? t('未命名角色')
	}
	const pushText = (key: string, value: ReactNode) => {
		curated.push(key)
		rows.push(
			<div key={key} className={styles.fieldWide}>
				<dt>{labelFor(key)}</dt>
				<dd>{value}</dd>
			</div>,
		)
	}
	const pushChapter = (key: string) => {
		const raw = entry[key]
		if (typeof raw !== 'string' || !raw) return
		pushText(key, chapterText(raw, chapterOrder))
	}
	const pushSimple = (key: string) => {
		const value = asText(entry[key])
		if (value) pushText(key, value)
	}

	if (kind === 'character') {
		pushSimple('identity')
		pushSimple('personality')
		pushSimple('speech')
		const appearanceRaw = entry.appearance
		const appearanceText =
			appearanceRaw && typeof appearanceRaw === 'object'
				? asText((appearanceRaw as { description?: unknown }).description)
				: undefined
		if (appearanceText) {
			curated.push('appearance')
			rows.push(
				<div key="appearance" className={styles.fieldWide}>
					<dt>{t('外貌')}</dt>
					<dd>{appearanceText}</dd>
				</div>,
			)
		}
		const aliases = asTextList(entry.aliases)
		if (aliases.length) {
			pushText('aliases', aliases.join(t('、')))
		}
		const addresses = asAddressList(entry.addresses)
		if (addresses.length) {
			curated.push('addresses')
			const seenAddresses = new Map<string, number>()
			rows.push(
				<div key="addresses" className={styles.fieldWide}>
					<dt>{t('称呼')}</dt>
					<dd>
						<ul className={styles.chipList}>
							{addresses.map((address) => {
								const speaker = characterName(address.speakerId)
								const base = `${speaker}-${address.name ?? ''}`
								const count = (seenAddresses.get(base) ?? 0) + 1
								seenAddresses.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.chip}>
										{speaker}
										{' → '}
										{address.name ?? ''}
									</li>
								)
							})}
						</ul>
					</dd>
				</div>,
			)
		}
		pushChapter('firstSeenChapter')
		pushChapter('revealedChapter')
		const changes = asChangeList(entry.changes)
		if (changes.length) {
			curated.push('changes')
			rows.push(
				<div key="changes" className={styles.fieldWide}>
					<dt>{t('剧情变化')}</dt>
					<dd>
						<ChangeList changes={changes} chapterOrder={chapterOrder} />
					</dd>
				</div>,
			)
		}
	} else if (kind === 'location') {
		pushSimple('description')
		const variants = asDescribedList(entry.variants)
		if (variants.length) {
			curated.push('variants')
			rows.push(
				<div key="variants" className={styles.fieldWide}>
					<dt>{t('变体')}</dt>
					<dd>
						<ul className={styles.chipList}>
							{variants.map((variant) => (
								<li key={variant.id} className={styles.chip}>
									{nameOrSlug(variant)}
								</li>
							))}
						</ul>
					</dd>
				</div>,
			)
		}
		pushChapter('firstSeenChapter')
		pushChapter('revealedChapter')
	} else if (kind === 'relation') {
		curated.push('from', 'to')
		rows.push(
			<div key="pair" className={styles.fieldWide}>
				<dt>{t('角色')}</dt>
				<dd>
					{characterName(entry.from)}
					<ArrowLeftRight
						aria-hidden="true"
						size={13}
						strokeWidth={1.8}
						className={styles.relationIconInline}
					/>
					{characterName(entry.to)}
				</dd>
			</div>,
		)
		pushSimple('description')
		pushChapter('firstSeenChapter')
		pushChapter('revealedChapter')
	} else if (kind === 'timeline') {
		pushSimple('storyTime')
		pushSimple('event')
		pushChapter('chapterId')
	} else if (kind === 'foreshadowing') {
		pushSimple('description')
		pushChapter('plantedChapter')
		pushChapter('resolvedChapter')
	} else if (kind === 'style') {
		pushSimple('description')
		pushSimple('narration')
		const references = Array.isArray(entry.references)
			? entry.references
					.map((ref) =>
						ref && typeof ref === 'object'
							? asText((ref as { description?: unknown }).description)
							: undefined,
					)
					.filter((item): item is string => Boolean(item))
			: []
		if (references.length) {
			curated.push('references')
			const seenRefs = new Map<string, number>()
			rows.push(
				<div key="references" className={styles.fieldWide}>
					<dt>{t('参考图')}</dt>
					<dd>
						<ul className={styles.chipList}>
							{references.map((description) => {
								const count = (seenRefs.get(description) ?? 0) + 1
								seenRefs.set(description, count)
								return (
									<li key={`${description}-${count}`} className={styles.chip}>
										{description}
									</li>
								)
							})}
						</ul>
					</dd>
				</div>,
			)
		}
	} else if (kind === 'glossary') {
		if (asText(entry.original) || asText(entry.written)) {
			curated.push('original', 'written')
			rows.push(
				<div key="wording" className={styles.fieldWide}>
					<dt>{t('作品写法')}</dt>
					<dd>
						{asText(entry.original) ?? '—'}
						{' → '}
						<strong>{asText(entry.written) ?? '—'}</strong>
					</dd>
				</div>,
			)
		}
		pushSimple('pronunciation')
		pushSimple('category')
		pushSimple('note')
	}

	return (
		<>
			{rows.length > 0 && (
				<dl className={`${styles.fields} ${styles.curatedFields}`}>{rows}</dl>
			)}
			<OtherFields
				entry={entry}
				omit={[...curated, 'name', 'written', 'originalName']}
				chapterOrder={chapterOrder}
				characters={characters}
			/>
		</>
	)
}
