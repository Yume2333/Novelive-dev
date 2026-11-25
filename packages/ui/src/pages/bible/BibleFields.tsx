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
import { type ReactNode, useState } from 'react'
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
	coverGradientVar,
	entryLayer,
	hashIndex,
	isWithinChapter,
	locationCandidateAssetIds,
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
	omit = ['id', 'status', 'occurrences', 'conflict', 'layer', 'scope'],
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

function statusLabel(status: string): string {
	return status === 'confirmed' ? t('已确认') : t('候选')
}

function askAgentButton(
	onAskAgent: ((entryId: string, label: string) => void) | undefined,
	entryId: string,
	label: string,
) {
	if (!onAskAgent) return null
	return (
		<Button
			size="sm"
			variant="ghost"
			icon={Sparkles}
			className={styles.askBtn}
			onClick={() => onAskAgent(entryId, label)}
		>
			{t('问 Agent 修改')}
		</Button>
	)
}

/** 来源层级标记：系列 / 卷 / 作品（下级同 ID 条目整条覆盖上级） */
export function LayerChip({ entry }: { entry: unknown }) {
	const layer = entryLayer(entry)
	if (layer === undefined) return null
	const label =
		layer === 'series' ? t('系列') : layer === 'volume' ? t('卷') : t('作品')
	return (
		<Tooltip text={t('下级同 ID 条目整条覆盖')}>
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
					{change.chapterId}
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

const handledLocationKeys = [
	'id',
	'status',
	'occurrences',
	'conflict',
	'name',
	'description',
	'variants',
	'references',
	'changes',
	'firstSeenChapter',
	'revealedChapter',
	'layer',
	'scope',
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
				<Chip active={location.status === 'confirmed'}>
					{statusLabel(location.status)}
				</Chip>
				<LayerChip entry={location} />
				{location.firstSeenChapter && (
					<span className={styles.muted}>
						{t('首次出现：{{chapter}}', {
							chapter: location.firstSeenChapter,
						})}
					</span>
				)}
				{location.revealedChapter && (
					<span className={styles.muted}>
						{t('揭示章节')} {location.revealedChapter}
					</span>
				)}
				<span className={styles.cardActions}>
					{askAgentButton(onAskAgent, location.id, location.name)}
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
					className={styles.mediaActions}
					style={{ display: 'flex', gap: 'var(--space-2)' }}
					onClick={(event) => event.stopPropagation()}
				>
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

			<p className={styles.detailText}>{location.description}</p>

			{variants.length > 0 && (
				<div className={styles.variantChips}>
					{variants.map((variant) => (
						<Tooltip key={variant.id} text={variant.description}>
							<Chip>{variant.id}</Chip>
						</Tooltip>
					))}
				</div>
			)}

			<ChangeList
				changes={location.changes}
				chapterCutoff={chapterCutoff}
				chapterOrder={chapterOrder}
			/>

			<Fields
				entry={location as unknown as Record<string, unknown>}
				omit={handledLocationKeys}
			/>

			{occurrences}
		</article>
	)
}

const handledRelationKeys = [
	'id',
	'status',
	'occurrences',
	'conflict',
	'from',
	'to',
	'description',
	'changes',
	'revealedChapter',
	'layer',
	'scope',
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
		characters.find((item) => item.id === relation.from)?.name ?? relation.from
	const toName =
		characters.find((item) => item.id === relation.to)?.name ?? relation.to
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
				<Chip active={relation.status === 'confirmed'}>
					{statusLabel(relation.status)}
				</Chip>
				<LayerChip entry={relation} />
				{relation.revealedChapter && (
					<span className={styles.muted}>
						{t('揭示章节')} {relation.revealedChapter}
					</span>
				)}
				<span className={styles.cardActions}>
					{askAgentButton(onAskAgent, relation.id, label)}
				</span>
			</header>

			{relation.conflict && (
				<p className={styles.conflictBox}>{relation.conflict}</p>
			)}

			<p className={styles.detailText}>{relation.description}</p>

			<ChangeList
				changes={relation.changes}
				chapterCutoff={chapterCutoff}
				chapterOrder={chapterOrder}
			/>

			<Fields
				entry={relation as unknown as Record<string, unknown>}
				omit={handledRelationKeys}
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
			<ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
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
							<Chip>{entry.chapterId}</Chip>
							{entry.status !== 'confirmed' && <Chip>{t('候选')}</Chip>}
							{onAskAgent && (
								<span className={`row-actions ${styles.rowAskBtn}`}>
									<IconButton
										icon={Sparkles}
										label={t('问 Agent 修改')}
										size={28}
										onClick={() => onAskAgent(entry.id, entry.event)}
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
			<ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
				{shown.map((entry) => {
					const closed =
						Boolean(entry.resolvedChapter) &&
						isWithinChapter(entry.resolvedChapter, chapterCutoff, chapterOrder)
					const meta = entry.resolvedChapter
						? closed
							? t('{{chapter}} 已回收', { chapter: entry.resolvedChapter })
							: t('{{chapter}} 回收', { chapter: entry.resolvedChapter })
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
									{t('埋于 {{chapter}}', { chapter: entry.plantedChapter })}
									{' · '}
									{meta}
								</span>
								{entry.status !== 'confirmed' && <Chip>{t('候选')}</Chip>}
								{onAskAgent && (
									<span className={`row-actions ${styles.rowAskBtn}`}>
										<IconButton
											icon={Sparkles}
											label={t('问 Agent 修改')}
											size={28}
											onClick={() => onAskAgent(entry.id, entry.description)}
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

const handledStyleKeys = [
	'id',
	'status',
	'occurrences',
	'conflict',
	'description',
	'narration',
	'references',
	'layer',
	'scope',
] as const

function StyleRefThumb({
	path,
	alt,
	source,
}: {
	path: string
	alt: string
	source: string
}) {
	const [failed, setFailed] = useState(false)
	const url = assetResourceUrl(path)
	return (
		<div
			className={styles.styleRefThumb}
			style={{ background: coverGradientVar(path) }}
		>
			{url && !failed && (
				<img
					className={styles.styleRefImg}
					src={url}
					alt={alt}
					loading="lazy"
					onError={() => setFailed(true)}
				/>
			)}
			<span className={`label-caps label-caps-zh ${styles.styleRefSource}`}>
				{source}
			</span>
		</div>
	)
}

export function StylesView({
	entries,
	focused,
	renderOccurrences,
	onPreview,
	onAskAgent,
}: {
	entries: readonly BibleStyle[]
	focused?: string
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
						<Chip active={style.status === 'confirmed'}>
							{statusLabel(style.status)}
						</Chip>
						<LayerChip entry={style} />
						<span className={styles.cardActions}>
							{askAgentButton(onAskAgent, style.id, t('风格'))}
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
							<p className={styles.styleBody}>{style.description}</p>
						</div>
						{style.narration && (
							<div className={styles.styleBlock}>
								<div
									className={`label-caps label-caps-zh ${styles.styleLabel}`}
								>
									{t('旁白语气')}
								</div>
								<p className={styles.styleBody}>{style.narration}</p>
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
															source: ref.path,
															gradientIndex: hashIndex(ref.path, 6),
														})
													}
												>
													<StyleRefThumb
														path={ref.path}
														alt={ref.description}
														source={ref.path}
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

					<Fields
						entry={style as unknown as Record<string, unknown>}
						omit={handledStyleKeys}
					/>

					{renderOccurrences?.(style)}
				</article>
			))}
		</>
	)
}

export function GlossaryTable({
	entries,
	focused,
	renderOccurrences,
	onAskAgent,
}: {
	entries: readonly BibleGlossary[]
	focused?: string
	renderOccurrences?: (entry: BibleGlossary) => ReactNode
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
							<th scope="col">{t('定位')}</th>
							{onAskAgent && <th scope="col">{t('操作')}</th>}
						</tr>
					</thead>
					<tbody>
						{entries.map((entry) => (
							<tr
								key={entry.id}
								id={`bible-entry-${entry.id}`}
								data-focused={focused === entry.id || undefined}
								className="hover-row"
							>
								<td>{entry.original}</td>
								<th scope="row">
									{entry.written}
									{entry.status !== 'confirmed' && <Chip>{t('候选')}</Chip>}
								</th>
								<td>{entry.pronunciation || '—'}</td>
								<td>
									<Chip>{entry.category}</Chip>
								</td>
								<td>{entry.note || '—'}</td>
								<td>{renderOccurrences?.(entry)}</td>
								{onAskAgent && (
									<td>
										<span className={`row-actions ${styles.rowAskBtn}`}>
											<IconButton
												icon={Sparkles}
												label={t('问 Agent 修改')}
												size={28}
												onClick={() => onAskAgent(entry.id, entry.written)}
											/>
										</span>
									</td>
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Card>
	)
}
