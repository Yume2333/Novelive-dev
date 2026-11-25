import {
	ArrowRight,
	Lock,
	PenLine,
	RefreshCw,
	Sparkles,
	User,
	UserX,
} from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Button, Chip, SectionLabel, Spinner, Tooltip } from '../../components'
import { scoped } from '../../i18n'
import { ChangeList, Fields, LayerChip } from './BibleFields'
import styles from './BiblePage.module.css'
import {
	assetResourceUrl,
	type BibleCharacter,
	coverGradientVar,
	isWithinChapter,
	type PreviewTarget,
	type ResolvedAssetMap,
} from './bibleHelpers'

const t = scoped('bible')

const handledCharacterKeys = [
	'id',
	'status',
	'occurrences',
	'conflict',
	'name',
	'originalName',
	'aliases',
	'major',
	'addresses',
	'identity',
	'personality',
	'speech',
	'appearance',
	'costumes',
	'expressions',
	'references',
	'reuse',
	'knows',
	'changes',
	'firstSeenChapter',
	'revealedChapter',
] as const

/** 渐变圆形角色徽标；一次性角色用 UserX 标记 */
export function CharacterAvatar({
	character,
	size = 44,
}: {
	character: Pick<BibleCharacter, 'id' | 'name' | 'reuse'>
	size?: number
}) {
	const Icon = character.reuse === 'one-off' ? UserX : User
	return (
		<span
			className={styles.avatarBadge}
			style={{
				width: size,
				height: size,
				background: coverGradientVar(character.id),
			}}
		>
			<Icon
				size={Math.round(size * 0.52)}
				strokeWidth={1.8}
				aria-hidden="true"
			/>
		</span>
	)
}

type AssetProps = {
	resolvedAssets?: ResolvedAssetMap
	assetVersions?: Readonly<Record<string, number>>
	regenKeys?: Readonly<Record<string, boolean>>
	onPreview?: (target: PreviewTarget) => void
	onRegen?: (assetId: string, label: string) => void
}

function ExpressionCard({
	character,
	costumeId,
	costumeDescription,
	expr,
	singleBase,
	resolvedAssets,
	assetVersions,
	regenKeys,
	onPreview,
	onRegen,
}: {
	character: BibleCharacter
	costumeId: string
	costumeDescription: string
	expr: { id: string; description: string }
	singleBase?: boolean
} & AssetProps) {
	const assetId = `${character.id}/${costumeId}/${expr.id}`
	const cachePath = resolvedAssets?.[assetId] ?? undefined
	const imgUrl = assetResourceUrl(cachePath, assetVersions?.[assetId])
	const drawn = Boolean(imgUrl)
	const isRegen = Boolean(regenKeys?.[assetId])
	const openPreview = () => {
		onPreview?.({
			kind: 'expression',
			charId: character.id,
			costumeId,
			exprId: expr.id,
			assetId,
			title: `${character.name} · ${costumeId} · ${expr.id}`,
			subtitle: costumeDescription,
			description: expr.description,
		})
	}
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (
			event.target === event.currentTarget &&
			(event.key === 'Enter' || event.key === ' ')
		) {
			event.preventDefault()
			openPreview()
		}
	}
	return (
		<Tooltip
			text={
				drawn
					? t('{{costume}} · {{expr}}（点击预览）', {
							costume: costumeId,
							expr: expr.id,
						})
					: t('{{expr}} · 还没画（点击查看详情）', { expr: expr.id })
			}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: 复合媒体块内含重绘子按钮与生成遮罩，不能用原生 button 嵌套 */}
			<div
				role="button"
				tabIndex={0}
				onClick={openPreview}
				onKeyDown={onKeyDown}
				className={`${styles.mediaCard} ${styles.exprCard} ${
					drawn ? styles.exprCardDrawn : styles.exprCardEmpty
				}`}
			>
				<div className={styles.exprCardInner}>
					{drawn && imgUrl ? (
						<>
							<img className={styles.exprImg} src={imgUrl} alt={expr.id} />
							<span className={styles.exprLabel}>{expr.id}</span>
						</>
					) : (
						<>
							<PenLine aria-hidden="true" size={18} strokeWidth={1.8} />
							{!singleBase && (
								<span className={styles.exprLabel}>{expr.id}</span>
							)}
							<span className={styles.exprLabel}>{t('还没画')}</span>
						</>
					)}
				</div>
				{isRegen ? (
					<div className={styles.shimmerOverlay}>
						<div className={styles.shimmerContent}>
							<Spinner size={14} />
							<span className={`ink-shimmer ${styles.shimmerText}`}>
								{t('正在生成…')}
							</span>
						</div>
					</div>
				) : (
					drawn &&
					onRegen && (
						<button
							type="button"
							className={`${styles.mediaActions} ${styles.exprRegenBtn}`}
							aria-label={t('重新生成')}
							onClick={(event) => {
								event.stopPropagation()
								onRegen(assetId, `${character.name} · ${expr.id}`)
							}}
						>
							<RefreshCw size={11} strokeWidth={1.8} aria-hidden="true" />
						</button>
					)
				)}
			</div>
		</Tooltip>
	)
}

/** 造型 + 表情网格；按章节筛选拆分可见与未来造型 */
function OutfitExpressions({
	character,
	chapterCutoff,
	chapterOrder,
	resolvedAssets,
	assetVersions,
	regenKeys,
	onPreview,
	onRegen,
}: {
	character: BibleCharacter
	chapterCutoff?: number
	chapterOrder?: ReadonlyMap<string, number>
} & AssetProps) {
	const costumes = character.costumes ?? []
	const visibleCostumes = costumes.filter((costume) =>
		isWithinChapter(costume.fromChapter, chapterCutoff, chapterOrder),
	)
	const futureCostumes = costumes.filter(
		(costume) =>
			!isWithinChapter(costume.fromChapter, chapterCutoff, chapterOrder),
	)
	const expressions = character.expressions ?? []
	const assetProps: AssetProps = {
		resolvedAssets,
		assetVersions,
		regenKeys,
		onPreview,
		onRegen,
	}

	if (costumes.length === 0) {
		if (expressions.length === 0) return null
		return (
			<section className={styles.detailSection}>
				<SectionLabel>{t('表情')}</SectionLabel>
				<div className={styles.exprRow}>
					{expressions.map((expr) => (
						<ExpressionCard
							key={expr.id}
							character={character}
							costumeId="base"
							costumeDescription={expr.description}
							expr={expr}
							{...assetProps}
						/>
					))}
				</div>
			</section>
		)
	}

	return (
		<section className={styles.detailSection}>
			<SectionLabel>{t('造型与表情')}</SectionLabel>
			<div className={styles.outfitList}>
				{visibleCostumes.map((costume) => {
					const syntheticBase = expressions.length === 0
					const exprList = syntheticBase
						? [{ id: 'base', description: costume.description }]
						: expressions
					return (
						<div key={costume.id} className={styles.outfitBlock}>
							<div className={styles.outfitHead}>
								<span className={styles.outfitName}>{costume.id}</span>
								{costume.fromChapter && (
									<Chip>
										{t('起始章')} {costume.fromChapter}
									</Chip>
								)}
							</div>
							<p className={styles.outfitDesc}>{costume.description}</p>
							<div className={styles.exprRow}>
								{exprList.map((expr) => (
									<ExpressionCard
										key={expr.id}
										character={character}
										costumeId={costume.id}
										costumeDescription={costume.description}
										expr={expr}
										singleBase={syntheticBase}
										{...assetProps}
									/>
								))}
							</div>
						</div>
					)
				})}
				{futureCostumes.map((costume) => (
					<div key={costume.id} className={styles.futureOutfit}>
						<Lock aria-hidden="true" size={13} strokeWidth={1.8} />
						<span>
							{t('{{chapter}} 起有新造型「{{name}}」（当前筛选不展示）', {
								chapter: costume.fromChapter ?? '',
								name: costume.id,
							})}
						</span>
					</div>
				))}
			</div>
		</section>
	)
}

export function CharacterDetail({
	character,
	characters,
	focused,
	occurrences,
	chapterCutoff,
	chapterOrder,
	resolvedAssets,
	assetVersions,
	regenKeys,
	onPreview,
	onRegen,
	onAskAgent,
}: {
	character: BibleCharacter
	characters: readonly BibleCharacter[]
	focused?: boolean
	occurrences?: ReactNode
	chapterCutoff?: number
	chapterOrder?: ReadonlyMap<string, number>
	resolvedAssets?: ResolvedAssetMap
	assetVersions?: Readonly<Record<string, number>>
	regenKeys?: Readonly<Record<string, boolean>>
	onPreview?: (target: PreviewTarget) => void
	onRegen?: (assetId: string, label: string) => void
	onAskAgent?: (entryId: string, label: string) => void
}) {
	const beforeFirst =
		Boolean(character.firstSeenChapter) &&
		!isWithinChapter(character.firstSeenChapter, chapterCutoff, chapterOrder)

	const profileRows: { key: string; label: string; content: ReactNode }[] = []
	if (character.originalName)
		profileRows.push({
			key: 'originalName',
			label: t('原文名字'),
			content: character.originalName,
		})
	if (character.aliases.length > 0)
		profileRows.push({
			key: 'aliases',
			label: t('别名'),
			content: (
				<ul className={styles.chipList}>
					{character.aliases.map((alias) => (
						<li key={alias}>
							<Chip>{alias}</Chip>
						</li>
					))}
				</ul>
			),
		})
	if (character.identity)
		profileRows.push({
			key: 'identity',
			label: t('身份'),
			content: character.identity,
		})
	if (character.personality)
		profileRows.push({
			key: 'personality',
			label: t('性格'),
			content: character.personality,
		})
	if (character.speech)
		profileRows.push({
			key: 'speech',
			label: t('说话方式'),
			content: character.speech,
		})

	const knows = (character.knows ?? []).filter((item) =>
		isWithinChapter(item.chapterId, chapterCutoff, chapterOrder),
	)
	const hasGallery =
		(character.costumes?.length ?? 0) > 0 ||
		(character.expressions?.length ?? 0) > 0

	return (
		<article
			className={`${styles.card} ${beforeFirst ? styles.charDimmed : ''}`}
			id={`bible-entry-${character.id}`}
			data-focused={focused || undefined}
		>
			<header className={styles.charHead}>
				<CharacterAvatar character={character} size={52} />
				<div className={styles.charHeadBody}>
					<div className={styles.charTitleRow}>
						<h3 className="headline">{character.name}</h3>
						<Chip active={character.status === 'confirmed'}>
							{character.status === 'confirmed' ? t('已确认') : t('候选')}
						</Chip>
						<LayerChip entry={character} />
						{character.major && <Chip>{t('主要角色')}</Chip>}
						{character.reuse && (
							<Chip>
								{character.reuse === 'reusable' ? t('可复用') : t('一次性')}
							</Chip>
						)}
					</div>
					{(character.firstSeenChapter || character.revealedChapter) && (
						<div className={styles.charMeta}>
							{character.firstSeenChapter && (
								<span>
									{t('首次出场')} {character.firstSeenChapter}
								</span>
							)}
							{character.revealedChapter && (
								<span>
									{t('揭示章节')} {character.revealedChapter}
								</span>
							)}
							{beforeFirst && <span>{t('当前章节前尚未出场')}</span>}
						</div>
					)}
				</div>
				{onAskAgent && (
					<Button
						size="sm"
						variant="ghost"
						icon={Sparkles}
						className={styles.askBtn}
						onClick={() => onAskAgent(character.id, character.name)}
					>
						{t('问 Agent 修改')}
					</Button>
				)}
			</header>

			{character.conflict && (
				<p className={styles.conflictBox}>{character.conflict}</p>
			)}

			{profileRows.length > 0 && (
				<dl className={styles.fields}>
					{profileRows.map((row) => (
						<div key={row.key}>
							<dt>{row.label}</dt>
							<dd>{row.content}</dd>
						</div>
					))}
				</dl>
			)}

			{character.appearance && (
				<section className={styles.detailSection}>
					<SectionLabel>{t('外貌')}</SectionLabel>
					<p className={styles.detailText}>
						{character.appearance.description}
					</p>
					{character.appearance.anchorFeatures &&
						character.appearance.anchorFeatures.length > 0 && (
							<div className={styles.subGroup}>
								<span className={styles.subLabel}>{t('锚点特征')}</span>
								<ul className={styles.chipList}>
									{character.appearance.anchorFeatures.map((feature) => (
										<li key={feature}>
											<Chip>{feature}</Chip>
										</li>
									))}
								</ul>
							</div>
						)}
					{character.appearance.keyColors && (
						<div className={styles.subGroup}>
							<span className={styles.subLabel}>{t('关键颜色')}</span>
							<dl className={styles.keyColors}>
								<div>
									<dt>{t('发色')}</dt>
									<dd>{character.appearance.keyColors.hair}</dd>
								</div>
								<div>
									<dt>{t('瞳色')}</dt>
									<dd>{character.appearance.keyColors.eyes}</dd>
								</div>
								<div>
									<dt>{t('服装')}</dt>
									<dd>{character.appearance.keyColors.clothing}</dd>
								</div>
							</dl>
						</div>
					)}
				</section>
			)}

			{character.addresses && character.addresses.length > 0 && (
				<section className={styles.detailSection}>
					<SectionLabel>{t('称呼')}</SectionLabel>
					<ul className={styles.objectList}>
						{(() => {
							const seen = new Map<string, number>()
							return character.addresses.map((address) => {
								const speakerName =
									characters.find((item) => item.id === address.speakerId)
										?.name ?? address.speakerId
								const base = `${address.speakerId}-${address.name}`
								const count = (seen.get(base) ?? 0) + 1
								seen.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.addressRow}>
										<span>{speakerName}</span>
										<ArrowRight
											aria-hidden="true"
											size={13}
											strokeWidth={1.8}
										/>
										<strong>{address.name}</strong>
									</li>
								)
							})
						})()}
					</ul>
				</section>
			)}

			{hasGallery && (
				<OutfitExpressions
					character={character}
					chapterCutoff={chapterCutoff}
					chapterOrder={chapterOrder}
					resolvedAssets={resolvedAssets}
					assetVersions={assetVersions}
					regenKeys={regenKeys}
					onPreview={onPreview}
					onRegen={onRegen}
				/>
			)}

			{knows.length > 0 && (
				<section className={styles.detailSection}>
					<SectionLabel>{t('已知事实')}</SectionLabel>
					<ul className={styles.objectList}>
						{(() => {
							const seen = new Map<string, number>()
							return knows.map((item) => {
								const base = `${item.chapterId}-${item.fact}`
								const count = (seen.get(base) ?? 0) + 1
								seen.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.changeRow}>
										<Chip>{item.chapterId}</Chip>
										<span>{item.fact}</span>
									</li>
								)
							})
						})()}
					</ul>
				</section>
			)}

			{character.references && character.references.length > 0 && (
				<section className={styles.detailSection}>
					<SectionLabel>{t('参考图')}</SectionLabel>
					<ul className={styles.objectList}>
						{(() => {
							const seen = new Map<string, number>()
							return character.references.map((ref) => {
								const base = `${ref.path}-${ref.description}`
								const count = (seen.get(base) ?? 0) + 1
								seen.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.subCard}>
										<strong>{ref.description}</strong>
										<code className={styles.refPath}>{ref.path}</code>
									</li>
								)
							})
						})()}
					</ul>
				</section>
			)}

			{(character.changes?.length ?? 0) > 0 && (
				<section className={styles.detailSection}>
					<SectionLabel>{t('剧情变化')}</SectionLabel>
					<ChangeList
						changes={character.changes}
						chapterCutoff={chapterCutoff}
						chapterOrder={chapterOrder}
					/>
				</section>
			)}

			<Fields
				entry={character as unknown as Record<string, unknown>}
				omit={handledCharacterKeys}
			/>

			{occurrences}
		</article>
	)
}
