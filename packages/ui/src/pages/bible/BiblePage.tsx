import type {
	CommandInput,
	CommandOutput,
	Proposal,
} from '@novelive/creator/contract'
import {
	Check,
	ChevronRight,
	CircleCheck,
	CircleHelp,
	Clock,
	Eye,
	Handshake,
	Image as ImageIcon,
	Languages,
	type LucideIcon,
	Mountain,
	Palette,
	RefreshCw,
	Users,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import {
	Banner,
	Button,
	Chip,
	CompactSelect,
	Drawer,
	EmptyState,
	ErrorNotice,
	IconButton,
	LoadingState,
	Modal,
	Page,
	ScrollArea,
	Slider,
	Spinner,
	TextInput,
	Tooltip,
	useToast,
} from '../../components'
import { formatVolumeLabel } from '../../format/chapter'
import {
	formatErrorText,
	type HumanizedError,
	humanizeError,
} from '../../format/errors'
import { msg, scoped } from '../../i18n'
import {
	EntryDetails,
	ForeshadowingView,
	formatConflictValue,
	GlossaryTable,
	LocationCard,
	labelFor,
	Occurrences,
	RelationCard,
	StatusChip,
	StylesView,
	TimelineView,
} from './BibleFields'
import styles from './BiblePage.module.css'
import {
	assetResourceUrl,
	type Bible,
	type BibleCharacter,
	type BibleEntry,
	chapterText,
	isWithinChapter,
	locationCandidateAssetIds,
	nameOrSlug,
	type PreviewTarget,
	parseChapterNumber,
	type ResolvedAssetMap,
} from './bibleHelpers'
import candidateStyles from './Candidates.module.css'
import { CharacterAvatar, CharacterDetail } from './CharacterDetail'

const t = scoped('bible')

type Entry = BibleEntry
type ProposalEntry = Extract<
	Proposal['payload'],
	{ kind: 'bible' }
>['changes'][number]['entry']

const categories = [
	['characters', msg('角色')],
	['relations', msg('关系')],
	['locations', msg('地点')],
	['timeline', msg('时间线')],
	['foreshadowing', msg('伏笔')],
	['styles', msg('风格')],
	['glossary', msg('术语')],
] as const
type CategoryKey = (typeof categories)[number][0]

const icons: Record<CategoryKey, LucideIcon> = {
	characters: Users,
	relations: Handshake,
	locations: Mountain,
	timeline: Clock,
	foreshadowing: Eye,
	styles: Palette,
	glossary: Languages,
}

/**
 * 设定集页的命令错误 → 人读提示。`not_found` 在格式层映射的是模型错误，
 * 在本页只可能是「找不到这部作品或卷」，因此换成页内文案；
 * 后端原文只进折叠的 detail。
 */
function bibleError(failure: unknown): HumanizedError {
	const record =
		failure && typeof failure === 'object'
			? (failure as { code?: unknown; message?: unknown })
			: undefined
	if (record?.code === 'not_found')
		return {
			message: t('工程中找不到这部作品或卷。'),
			...(typeof record.message === 'string' && record.message
				? { detail: record.message }
				: {}),
		}
	return humanizeError(failure)
}

/** 关系候选条目里 from / to 的展示名： confirmed 列表 → 同批候选 → 通用名，绝不回退到内部 id。 */
function relationSideName(
	id: unknown,
	bible: Bible,
	proposals: readonly Proposal[],
): string {
	if (typeof id !== 'string' || !id) return t('未命名角色')
	const confirmed = bible.characters.find((character) => character.id === id)
	if (confirmed?.name) return confirmed.name
	for (const proposal of proposals) {
		const payload = proposal.payload
		if (payload.kind !== 'bible') continue
		for (const change of payload.changes) {
			if (
				change.kind === 'character' &&
				change.entry.id === id &&
				'name' in change.entry &&
				typeof change.entry.name === 'string' &&
				change.entry.name
			)
				return change.entry.name
		}
	}
	return t('未命名角色')
}

/** 候选小节标题：按条目类型合成人类可读名，绝不回退到内部 id。 */
function candidateTitle(
	kind: keyof typeof collection,
	entry: Entry | ProposalEntry,
	bible: Bible,
	proposals: readonly Proposal[],
): string {
	const record = entry as Record<string, unknown>
	switch (kind) {
		case 'character':
			return typeof record.name === 'string' && record.name
				? record.name
				: t('未命名角色')
		case 'location':
			return typeof record.name === 'string' && record.name
				? record.name
				: t('未命名条目')
		case 'glossary': {
			const written = typeof record.written === 'string' ? record.written : ''
			const original =
				typeof record.original === 'string' ? record.original : ''
			if (original && written && original !== written)
				return `${original} → ${written}`
			if (written) return written
			if (original) return original
			return t('未命名条目')
		}
		case 'relation':
			return `${relationSideName(record.from, bible, proposals)} → ${relationSideName(record.to, bible, proposals)}`
		case 'timeline':
			return typeof record.event === 'string' && record.event
				? record.event
				: t('未命名条目')
		case 'foreshadowing':
			return typeof record.description === 'string' && record.description
				? record.description
				: t('未命名条目')
		case 'style': {
			const description =
				typeof record.description === 'string' ? record.description.trim() : ''
			return description ? `${t('画风')} · ${description}` : t('画风')
		}
	}
}

const collection = {
	character: 'characters',
	location: 'locations',
	glossary: 'glossary',
	relation: 'relations',
	timeline: 'timeline',
	foreshadowing: 'foreshadowing',
	style: 'styles',
} as const

function characterDescription(entry: Entry | ProposalEntry) {
	if ('description' in entry && typeof entry.description === 'string')
		return entry.description
}

export function approvalNotice(proposal: Proposal, bible: Bible) {
	let images = false
	let style = false
	if (proposal.payload.kind === 'bible') {
		for (const { kind, op, entry } of proposal.payload.changes) {
			if (op === 'none') continue
			if (kind === 'character') {
				const current = bible.characters.find(({ id }) => id === entry.id)
				images ||=
					!!current &&
					(op === 'delete' ||
						characterDescription(current) !== characterDescription(entry) ||
						JSON.stringify(current.appearance) !==
							JSON.stringify(entry.appearance) ||
						(current.costumes ?? []).some(
							(costume) =>
								costume.description !==
								entry.costumes?.find(({ id }) => id === costume.id)
									?.description,
						))
			} else if (kind === 'location') {
				const current = bible.locations.find(({ id }) => id === entry.id)
				images ||=
					!!current &&
					(op === 'delete' || current.description !== entry.description)
			} else if (kind === 'style') {
				const current = bible.styles.find(({ id }) => id === entry.id)
				style ||=
					op === 'delete' ||
					!current ||
					(['description', 'narration', 'references'] as const).some(
						(field) =>
							JSON.stringify(current[field]) !== JSON.stringify(entry[field]),
					)
			}
		}
	}
	return (
		t('已接受候选') +
		(images ? t('；受影响的已有图片已标记过期。') : t('。')) +
		(style ? t('风格变更仅提示，不自动过期。') : '')
	)
}

function Candidate({
	proposal,
	proposals,
	bible,
	chapterOrder,
	busy,
	resolve,
}: {
	proposal: Proposal
	proposals: readonly Proposal[]
	bible: Bible
	chapterOrder?: ReadonlyMap<string, number>
	busy: boolean
	resolve(id: string, reason?: string): void
}) {
	const [reason, setReason] = useState('')
	const payload = proposal.payload
	if (payload.kind !== 'bible' && payload.kind !== 'glossary') return null
	const changes =
		payload.kind === 'bible'
			? payload.changes
			: payload.changes.map((entry) => ({
					kind: 'glossary' as const,
					op: 'update' as const,
					entry,
				}))
	const action = bible.proposalActions[proposal.id]
	const stale = !action?.canApprove
	return (
		<article className={styles.proposalCard} aria-label={proposal.prompt}>
			<header className={styles.proposalHead}>
				<p className={candidateStyles.promptText}>{proposal.prompt}</p>
				<StatusChip status="candidate" />
			</header>
			{stale && (
				<Banner kind="warning" className={candidateStyles.staleBanner}>
					{action?.reason ??
						t('这条候选已过期或暂不能应用，因此无法接受；仍可拒绝。')}
				</Banner>
			)}
			{changes.map(({ kind, op, entry }) => {
				const confirmed = (bible[collection[kind]] as Entry[]).find(
					({ id }) => id === entry.id,
				)
				const conflicts =
					confirmed?.status === 'confirmed'
						? [...new Set([...Object.keys(confirmed), ...Object.keys(entry)])]
								.map(
									(key) =>
										[
											key,
											(entry as unknown as Record<string, unknown>)[key],
										] as const,
								)
								.filter(
									([key, value]) =>
										!['status', 'conflict', 'occurrences'].includes(key) &&
										!(
											kind === 'character' &&
											op === 'update' &&
											key === 'aliases' &&
											value === undefined
										) &&
										JSON.stringify(
											(confirmed as unknown as Record<string, unknown>)[key],
										) !== JSON.stringify(value),
								)
						: []
				return (
					<section
						className={styles.proposalSection}
						key={`${kind}/${entry.id}`}
					>
						<h4
							className={`${styles.proposalSectionTitle} ${candidateStyles.clampTitle}`}
						>
							{candidateTitle(kind, entry, bible, proposals)}
							{' · '}
							{
								{
									add: t('新增'),
									update: t('更新'),
									delete: t('删除'),
									none: t('不变'),
								}[op]
							}
						</h4>
						{conflicts.length > 0 && (
							<div className={styles.conflictBox}>
								<p className={styles.conflictTitle}>
									<strong>{t('与已确认内容冲突')}</strong>
								</p>
								{conflicts.map(([key, value]) => {
									const before = formatConflictValue(
										(confirmed as unknown as Record<string, unknown>)[key],
										{ key, chapterOrder, characters: bible.characters },
									)
									const after =
										value === undefined
											? t('移除')
											: formatConflictValue(value, {
													key,
													chapterOrder,
													characters: bible.characters,
												})
									return (
										<div className={styles.conflictRow} key={key}>
											<div>
												<span className={styles.conflictConfirmedLabel}>
													{t('已确认')} · {labelFor(key)}
												</span>
												<p className={styles.conflictValue}>{before}</p>
											</div>
											<div>
												<span className={styles.conflictCandidateLabel}>
													{t('候选')} · {labelFor(key)}
												</span>
												<p className={styles.conflictValue}>{after}</p>
											</div>
											<p className={styles.conflictSummary}>
												{t('{{label}}：{{before}} → {{after}}', {
													label: labelFor(key),
													before,
													after,
												})}
											</p>
										</div>
									)
								})}
							</div>
						)}
						{entry.conflict && (
							<p className={styles.conflictSummary}>{entry.conflict}</p>
						)}
						<EntryDetails
							kind={kind}
							entry={entry as unknown as Record<string, unknown>}
							chapterOrder={chapterOrder}
							characters={bible.characters}
						/>
						{kind === 'style' && (
							<p className={styles.muted}>
								{t('风格变更不会自动标记图片过期，请自行检查已有图片。')}
							</p>
						)}
					</section>
				)
			})}
			<div className={styles.decision}>
				<TextInput
					className={styles.decisionInput}
					aria-label={t('拒绝理由')}
					placeholder={t('拒绝理由')}
					value={reason}
					onChange={setReason}
				/>
				<div className={styles.decisionActions}>
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => resolve(proposal.id, reason)}
					>
						{t('拒绝候选')}
					</Button>
					<Button
						variant="primary"
						size="sm"
						disabled={busy || stale}
						onClick={() => resolve(proposal.id)}
					>
						{t('接受候选')}
					</Button>
				</div>
			</div>
		</article>
	)
}

interface AgentOutlet {
	setAgentPosition?(position: CommandInput<'chat.send'>['position']): void
	setAgentContextLabel?(label: string | undefined): void
	openAgent?(): void
}

export function BiblePage() {
	const { id: workId } = useParams()
	const [params, setParams] = useSearchParams()
	const volumeId = params.get('volume') ?? 'v0001'
	const [attempt, setAttempt] = useState(0)
	return (
		<BibleProjection
			key={`${workId}/${volumeId}/${attempt}`}
			workId={workId}
			volumeId={volumeId}
			changeVolume={(volume) => setParams({ volume })}
			refresh={() => setAttempt((value) => value + 1)}
		/>
	)
}

function BibleProjection({
	workId,
	volumeId,
	changeVolume,
	refresh,
}: {
	workId: string | undefined
	volumeId: string
	changeVolume(volume: string): void
	refresh(): void
}) {
	const toast = useToast()
	const outlet = useOutletContext<AgentOutlet | undefined>()
	const [bible, setBible] = useState<Bible>()
	const [proposals, setProposals] = useState<Proposal[]>([])
	const [category, setCategory] = useState<CategoryKey>('characters')
	const [error, setError] = useState<HumanizedError>()
	const [busy, setBusy] = useState(false)
	const [candidatesOpen, setCandidatesOpen] = useState(false)
	const [focused, setFocused] = useState('')
	const [preview, setPreview] = useState<PreviewTarget | null>(null)

	// 卷切换选项
	const [works, setWorks] = useState<
		CommandOutput<'library.list'>['works'] | undefined
	>()
	// 章节截止
	const [chapterOrder, setChapterOrder] = useState<
		ReadonlyMap<string, number> | undefined
	>()
	const [playerChapterCount, setPlayerChapterCount] = useState(0)
	const [chapterCutoff, setChapterCutoff] = useState(1)
	const manualCutoff = useRef(false)
	// 素材解引与重绘
	const [resolvedAssets, setResolvedAssets] = useState<ResolvedAssetMap>({})
	const [assetVersions, setAssetVersions] = useState<Record<string, number>>({})
	const [regenKeys, setRegenKeys] = useState<Record<string, boolean>>({})

	useEffect(() => {
		if (!workId) return
		let active = true
		setError(undefined)
		async function load() {
			try {
				const next = await window.novelive.call('bible.get', {
					workId: workId as string,
					volumeId,
				}).promise
				const candidates = await Promise.all(
					next.proposalIds.map(
						(proposalId) =>
							window.novelive.call('proposal.get', {
								workId: workId as string,
								proposalId,
							}).promise,
					),
				)
				if (active) {
					setBible(next)
					setProposals(candidates)
				}
			} catch (failure) {
				if (active) setError(bibleError(failure))
			}
		}
		void load()
		const off = window.novelive.on('creator.ready', () => void load())
		return () => {
			active = false
			off()
		}
	}, [workId, volumeId])

	// 卷切换：书库作品里同系列的各卷
	useEffect(() => {
		if (!workId) return
		let active = true
		window.novelive
			.call('library.list', {})
			.promise.then((result) => {
				if (active) setWorks(result.works)
			})
			.catch(() => {})
		return () => {
			active = false
		}
	}, [workId])

	// 章节顺序表：播放器章节顺序 → 序号映射
	useEffect(() => {
		if (!workId) return
		let active = true
		window.novelive
			.call('production.playerStatus', { workId })
			.promise.then((status) => {
				if (!active) return
				const order = new Map<string, number>()
				status.chapters.forEach((chapter, index) => {
					order.set(chapter.chapterId, index + 1)
				})
				setChapterOrder(order)
				setPlayerChapterCount(status.chapters.length)
			})
			.catch(() => {})
		return () => {
			active = false
		}
	}, [workId])
	// 总章数 = 播放器章数 / 书库章数 / 设定集条目最大章节号 的最大值（至少 1）
	const currentWork = works?.find((work) => work.workId === workId)
	const maxEntryChapter = (() => {
		if (!bible) return 0
		let maxParsed = 0
		const scan = (chapterId: string | undefined) => {
			const parsed = parseChapterNumber(chapterId)
			if (parsed !== undefined && parsed > maxParsed) maxParsed = parsed
		}
		for (const entry of bible.timeline) scan(entry.chapterId)
		for (const entry of bible.foreshadowing) {
			scan(entry.plantedChapter)
			scan(entry.resolvedChapter)
		}
		for (const character of bible.characters) {
			scan(character.firstSeenChapter)
			scan(character.revealedChapter)
			for (const change of character.changes ?? []) scan(change.chapterId)
			for (const costume of character.costumes ?? []) scan(costume.fromChapter)
		}
		for (const location of bible.locations) {
			scan(location.firstSeenChapter)
			scan(location.revealedChapter)
			for (const change of location.changes ?? []) scan(change.chapterId)
		}
		for (const relation of bible.relations) {
			scan(relation.firstSeenChapter)
			scan(relation.revealedChapter)
			for (const change of relation.changes ?? []) scan(change.chapterId)
		}
		return maxParsed
	})()

	const totalChapters = Math.max(
		playerChapterCount,
		currentWork?.chapters ?? 0,
		maxEntryChapter,
		1,
	)

	// 默认截止 = 总章数；用户没手动调过时跟随总章数增长
	useEffect(() => {
		setChapterCutoff((previous) =>
			manualCutoff.current ? previous : totalChapters,
		)
	}, [totalChapters])
	const volumeOptions = (() => {
		const volumes: { value: string; label: string }[] = []
		const seen = new Set<string>()
		if (currentWork?.project) {
			const siblings = works
				?.filter(
					(work) => work.project?.seriesId === currentWork.project?.seriesId,
				)
				.sort(
					(a, b) =>
						(a.project?.volumeIndex ?? 0) - (b.project?.volumeIndex ?? 0),
				)
			for (const sibling of siblings ?? []) {
				const project = sibling.project
				if (!project || seen.has(project.volumeId)) continue
				seen.add(project.volumeId)
				volumes.push({
					value: project.volumeId,
					label: formatVolumeLabel({
						index: project.volumeIndex,
						title: project.volumeTitle,
					}),
				})
			}
		}
		if (!seen.has(volumeId)) {
			const currentIndex = works?.find(
				(work) => work.project?.volumeId === volumeId,
			)?.project?.volumeIndex
			volumes.push({
				value: volumeId,
				label: formatVolumeLabel({ index: currentIndex }),
			})
		}
		return volumes
	})()
	const eyebrow = currentWork?.project
		? [
				currentWork.project.seriesTitle,
				formatVolumeLabel({
					index: currentWork.project.volumeIndex,
					title: currentWork.project.volumeTitle,
				}),
			]
				.filter(Boolean)
				.join(' · ')
		: undefined

	const entries: Entry[] = bible ? bible[category] : []
	const selected = entries.find((entry) => entry.id === focused) ?? entries[0]
	const selectedCharacter =
		category === 'characters' && selected
			? (selected as BibleCharacter)
			: undefined

	// 懒解引素材：当前选中角色的造型表情 + 地点视图里的地点基准图
	useEffect(() => {
		if (!workId || !bible) return
		const wanted = new Set<string>()
		if (category === 'characters' && selectedCharacter) {
			const costumes = selectedCharacter.costumes ?? []
			const expressions = selectedCharacter.expressions ?? []
			if (costumes.length === 0) {
				// 无造型角色：表情挂在 base 基准造型下（与 CharacterDetail 无造型分支一致）
				for (const expression of expressions)
					wanted.add(`${selectedCharacter.id}/base/${expression.id}`)
			}
			for (const costume of costumes) {
				wanted.add(`${selectedCharacter.id}/${costume.id}/base`)
				for (const expression of expressions)
					wanted.add(`${selectedCharacter.id}/${costume.id}/${expression.id}`)
			}
		}
		if (category === 'locations')
			for (const location of bible.locations)
				for (const assetId of locationCandidateAssetIds(location))
					wanted.add(assetId)
		const missing = [...wanted].filter(
			(assetId) => !(assetId in resolvedAssets),
		)
		if (!missing.length) return
		let active = true
		void Promise.all(
			missing.map((assetId) =>
				window.novelive
					.call('production.resolveAsset', { workId, assetId })
					.promise.then(
						(asset) => [assetId, asset?.cachePath ?? null] as const,
						() => [assetId, null] as const,
					),
			),
		).then((results) => {
			if (!active) return
			setResolvedAssets((previous) => {
				const next = { ...previous }
				for (const [assetId, cachePath] of results) next[assetId] = cachePath
				return next
			})
		})
		return () => {
			active = false
		}
	}, [workId, bible, category, selectedCharacter, resolvedAssets])

	// Agent 面板位置同步：选中角色或当前分类。
	// outlet context 对象每次渲染都是新引用，必须依赖内部稳定的 setter，否则会死循环。
	const setAgentPosition = outlet?.setAgentPosition
	const setAgentContextLabel = outlet?.setAgentContextLabel
	const selectedCharacterId =
		category === 'characters' ? selectedCharacter?.id : undefined
	const selectedCharacterName =
		category === 'characters' ? selectedCharacter?.name : undefined
	useEffect(() => {
		if (!setAgentPosition) return
		if (selectedCharacterId) {
			setAgentPosition({ kind: 'bible', entryId: selectedCharacterId })
			setAgentContextLabel?.(
				t('设定集 · {{label}}', { label: selectedCharacterName ?? '' }),
			)
		} else {
			setAgentPosition({ kind: 'bible' })
			setAgentContextLabel?.(
				t('设定集 · {{label}}', {
					label: t(categories.find(([key]) => key === category)?.[1] ?? ''),
				}),
			)
		}
		return () => {
			setAgentPosition(undefined)
			setAgentContextLabel?.(undefined)
		}
	}, [
		setAgentPosition,
		setAgentContextLabel,
		category,
		selectedCharacterId,
		selectedCharacterName,
	])

	const openAgentPanel = useCallback(() => {
		if (outlet?.openAgent) {
			outlet.openAgent()
			return
		}
		// 退路：找到侧边栏带 Ctrl/⌘+J 快捷键提示的 Agent 按钮（aria-pressed 反映开关态）
		const agentButton = [
			...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
		].find((button) => button.querySelector('kbd'))
		if (agentButton) {
			if (agentButton.getAttribute('aria-pressed') !== 'true')
				agentButton.click()
			return
		}
		// 最后手段：派发 Ctrl+J，由 AppShell 的全局快捷键切换面板
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'j',
				ctrlKey: true,
				bubbles: true,
			}),
		)
	}, [outlet])

	const handleAskAgent = useCallback(
		(entryId: string, entryLabel: string) => {
			outlet?.setAgentPosition?.({ kind: 'bible', entryId })
			outlet?.setAgentContextLabel?.(
				t('设定集 · {{label}}', { label: entryLabel }),
			)
			openAgentPanel()
		},
		[outlet, openAgentPanel],
	)

	const handleRegen = useCallback(
		async (assetId: string, label: string) => {
			if (!workId || regenKeys[assetId]) return
			setRegenKeys((previous) => ({ ...previous, [assetId]: true }))
			try {
				const { revision } = await window.novelive.call(
					'editor.imageRevision',
					{ workId, assetId },
				).promise
				const result = await window.novelive.call('editor.regenerateImage', {
					workId,
					assetId,
					expectedRevision: revision,
					count: 1,
				}).promise
				if (result.status === 'applied') {
					const asset = await window.novelive.call('production.resolveAsset', {
						workId,
						assetId,
					}).promise
					setResolvedAssets((previous) => ({
						...previous,
						[assetId]: asset?.cachePath ?? null,
					}))
					setAssetVersions((previous) => ({
						...previous,
						[assetId]: (previous[assetId] ?? 0) + 1,
					}))
					toast(t('已重新生成「{{label}}」', { label }), ImageIcon)
				} else {
					toast(
						t('「{{label}}」已生成候选，请在编辑器里挑选', { label }),
						ImageIcon,
					)
				}
			} catch (failure) {
				toast(formatErrorText(humanizeError(failure)), ImageIcon)
			} finally {
				setRegenKeys((previous) => {
					const next = { ...previous }
					delete next[assetId]
					return next
				})
			}
		},
		[workId, regenKeys, toast],
	)

	async function resolve(proposalId: string, reason?: string) {
		if (!workId || busy) return
		setBusy(true)
		setError(undefined)
		try {
			const result = await window.novelive.call('proposal.resolve', {
				workId,
				proposalId,
				decision:
					reason === undefined
						? { kind: 'approve' }
						: { kind: 'reject', reason },
			}).promise
			const noticeText =
				result.status === 'stale'
					? t('候选已过期，未修改已确认内容。')
					: result.status === 'restricted'
						? result.reason
						: reason === undefined
							? bible
								? approvalNotice(result.proposal, bible)
								: t('已接受候选。')
							: t('已拒绝候选，理由已保存。')
			const next = await window.novelive.call('bible.get', { workId, volumeId })
				.promise
			const candidates = await Promise.all(
				next.proposalIds.map(
					(proposalId) =>
						window.novelive.call('proposal.get', { workId, proposalId })
							.promise,
				),
			)
			setBible(next)
			setProposals(candidates)
			toast(noticeText, Check)
		} catch (failure) {
			setError(bibleError(failure))
		} finally {
			setBusy(false)
		}
	}

	const countFor = (key: CategoryKey): number => {
		if (!bible) return 0
		if (key === 'characters')
			return bible.characters.filter((entry) =>
				isWithinChapter(entry.firstSeenChapter, chapterCutoff, chapterOrder),
			).length
		if (key === 'relations')
			return bible.relations.filter((entry) =>
				isWithinChapter(entry.revealedChapter, chapterCutoff, chapterOrder),
			).length
		if (key === 'locations')
			return bible.locations.filter((entry) =>
				isWithinChapter(entry.firstSeenChapter, chapterCutoff, chapterOrder),
			).length
		if (key === 'timeline')
			return bible.timeline.filter((entry) =>
				isWithinChapter(entry.chapterId, chapterCutoff, chapterOrder),
			).length
		if (key === 'foreshadowing')
			return bible.foreshadowing.filter((entry) =>
				isWithinChapter(entry.plantedChapter, chapterCutoff, chapterOrder),
			).length
		return bible[key].length
	}

	const label = t(categories.find(([key]) => key === category)?.[1] ?? '')
	const occurrencesOf = (entry: Entry) => (
		<Occurrences entry={entry} chapterOrder={chapterOrder} />
	)

	// 灯箱数据派生
	const previewRegen =
		preview && preview.kind !== 'styleRef'
			? Boolean(regenKeys[preview.assetId])
			: false
	const previewVersion =
		preview && preview.kind !== 'styleRef'
			? (assetVersions[preview.assetId] ?? 0)
			: 0
	const [brokenPreviewUrls, setBrokenPreviewUrls] = useState<
		Readonly<Record<string, true>>
	>({})
	const rawPreviewUrl = (() => {
		if (!preview) return undefined
		if (preview.kind === 'styleRef') return assetResourceUrl(preview.path)
		const cachePath = resolvedAssets[preview.assetId]
		return assetResourceUrl(cachePath, previewVersion)
	})()
	const previewUrl =
		rawPreviewUrl && !brokenPreviewUrls[rawPreviewUrl]
			? rawPreviewUrl
			: undefined
	return (
		<Page
			title={t('设定集')}
			width={1200}
			eyebrow={eyebrow}
			actions={
				<div className={styles.headerControls}>
					<CompactSelect
						aria-label={t('切换卷')}
						value={volumeId}
						onChange={changeVolume}
						options={volumeOptions}
						disabled={busy}
					/>
					<IconButton
						icon={RefreshCw}
						label={t('刷新')}
						disabled={busy}
						onClick={refresh}
					/>
					<div className={styles.cutoffControl}>
						<Tooltip
							text={t(
								'只显示截至所选章节的设定；模型写第 N 章时也只会拿到这些设定',
							)}
						>
							<button
								type="button"
								className={styles.cutoffHelp}
								aria-label={t('章节筛选说明')}
							>
								<CircleHelp aria-hidden="true" size={16} strokeWidth={1.8} />
							</button>
						</Tooltip>
						<span className={styles.cutoffLabel}>
							{t('显示至第 {{chapter}} 章', { chapter: chapterCutoff })}
						</span>
						<Slider
							aria-label={t('截至章节')}
							value={chapterCutoff}
							onChange={(value) => {
								manualCutoff.current = true
								setChapterCutoff(value)
							}}
							min={1}
							max={totalChapters}
						/>
					</div>
				</div>
			}
		>
			<div className={styles.root}>
				{error && <ErrorNotice error={error} />}
				{!bible && !error && <LoadingState text={t('正在读取设定集…')} />}
				{bible && (
					<ScrollArea className={styles.scroll}>
						<div className={styles.layout}>
							<nav className={styles.nav} aria-label={t('设定分类')}>
								{categories.map(([key, name]) => {
									const Icon = icons[key]
									return (
										<button
											type="button"
											key={key}
											className={styles.navItem}
											aria-label={t(name)}
											aria-pressed={category === key}
											onClick={() => {
												setCategory(key)
												setFocused('')
											}}
										>
											<Icon aria-hidden="true" size={17} strokeWidth={1.8} />
											<span className={styles.navText}>{t(name)}</span>
											<span className={styles.navCount}>{countFor(key)}</span>
										</button>
									)
								})}
							</nav>
							<section
								className={styles.content}
								aria-label={t('设定集 · {{label}}', { label })}
							>
								<div className={styles.contentHead}>
									<Chip
										aria-expanded={candidatesOpen}
										onClick={() => setCandidatesOpen(!candidatesOpen)}
									>
										{proposals.length
											? t('候选与冲突 · {{length}} 项待处理', {
													length: proposals.length,
												})
											: t('候选与冲突 · 暂无待处理')}
										<ChevronRight
											aria-hidden="true"
											size={13}
											strokeWidth={1.8}
											className={styles.candidateChevron}
										/>
									</Chip>
								</div>
								<section
									className={styles.entries}
									aria-label={t('已登记内容')}
								>
									{entries.length === 0 &&
										category !== 'timeline' &&
										category !== 'foreshadowing' &&
										category !== 'styles' &&
										category !== 'glossary' && (
											<EmptyState
												card
												icon={icons[category]}
												text={t('暂无条目')}
											/>
										)}
									{category === 'characters' && entries.length > 0 ? (
										<div className={styles.characters}>
											<div className={styles.characterList}>
												{(entries as Bible['characters']).map((entry) => (
													<button
														type="button"
														key={entry.id}
														className={styles.characterItem}
														aria-current={selected === entry || undefined}
														onClick={() => setFocused(entry.id)}
													>
														<CharacterAvatar character={entry} size={32} />
														<span className={styles.characterItemText}>
															<span className={styles.characterName}>
																{entry.name}
															</span>
															{entry.firstSeenChapter !== undefined && (
																<span className={styles.characterSub}>
																	{t('首次出场')}{' '}
																	{chapterText(
																		entry.firstSeenChapter,
																		chapterOrder,
																	)}
																</span>
															)}
														</span>
													</button>
												))}
											</div>
											<div className={styles.cards}>
												{selectedCharacter && (
													<CharacterDetail
														key={selectedCharacter.id}
														character={selectedCharacter}
														characters={bible.characters}
														focused={focused === selectedCharacter.id}
														occurrences={occurrencesOf(selectedCharacter)}
														chapterCutoff={chapterCutoff}
														chapterOrder={chapterOrder}
														resolvedAssets={resolvedAssets}
														assetVersions={assetVersions}
														regenKeys={regenKeys}
														onPreview={setPreview}
														onRegen={(assetId, label) =>
															void handleRegen(assetId, label)
														}
														onAskAgent={handleAskAgent}
													/>
												)}
											</div>
										</div>
									) : null}
									{category === 'relations' &&
										(entries as Bible['relations']).map((entry) => (
											<RelationCard
												key={entry.id}
												relation={entry}
												characters={bible.characters}
												focused={focused === entry.id}
												chapterCutoff={chapterCutoff}
												chapterOrder={chapterOrder}
												occurrences={occurrencesOf(entry)}
												onAskAgent={handleAskAgent}
											/>
										))}
									{category === 'locations' &&
										(entries as Bible['locations']).map((entry) => (
											<LocationCard
												key={entry.id}
												location={entry}
												focused={focused === entry.id}
												chapterCutoff={chapterCutoff}
												chapterOrder={chapterOrder}
												resolvedAssets={resolvedAssets}
												assetVersions={assetVersions}
												regenKeys={regenKeys}
												occurrences={occurrencesOf(entry)}
												onPreview={setPreview}
												onRegen={(assetId, label) =>
													void handleRegen(assetId, label)
												}
												onAskAgent={handleAskAgent}
											/>
										))}
									{category === 'timeline' && (
										<TimelineView
											entries={bible.timeline}
											focused={focused}
											chapterCutoff={chapterCutoff}
											chapterOrder={chapterOrder}
											renderOccurrences={occurrencesOf}
											onAskAgent={handleAskAgent}
										/>
									)}
									{category === 'foreshadowing' && (
										<ForeshadowingView
											entries={bible.foreshadowing}
											focused={focused}
											chapterCutoff={chapterCutoff}
											chapterOrder={chapterOrder}
											renderOccurrences={occurrencesOf}
											onAskAgent={handleAskAgent}
										/>
									)}
									{category === 'styles' && (
										<StylesView
											entries={bible.styles}
											focused={focused}
											chapterOrder={chapterOrder}
											renderOccurrences={occurrencesOf}
											onPreview={setPreview}
											onAskAgent={handleAskAgent}
										/>
									)}
									{category === 'glossary' && (
										<GlossaryTable
											entries={bible.glossary}
											focused={focused}
											chapterOrder={chapterOrder}
											onAskAgent={handleAskAgent}
										/>
									)}
								</section>
							</section>
						</div>
					</ScrollArea>
				)}
			</div>

			<Drawer
				open={candidatesOpen}
				title={t('候选与冲突')}
				onClose={() => setCandidatesOpen(false)}
				width={460}
			>
				<div className={styles.drawerBody}>
					{!proposals.length && (
						<p className={styles.drawerEmpty}>
							<CircleCheck aria-hidden="true" size={14} strokeWidth={1.8} />
							{t('暂无待确认候选')}
						</p>
					)}
					{bible &&
						proposals.map((proposal) => (
							<Candidate
								key={proposal.id}
								proposal={proposal}
								proposals={proposals}
								bible={bible}
								chapterOrder={chapterOrder}
								busy={busy}
								resolve={(id, reason) => void resolve(id, reason)}
							/>
						))}
				</div>
			</Drawer>

			<Modal
				open={preview !== null}
				title={preview?.title ?? ''}
				onClose={() => setPreview(null)}
				width={520}
				footer={
					<div className={styles.lightboxFooterRow}>
						<Button variant="ghost" onClick={() => setPreview(null)}>
							{t('关闭')}
						</Button>
						{preview && preview.kind !== 'styleRef' && previewUrl ? (
							<Button
								variant="primary"
								icon={RefreshCw}
								loading={previewRegen}
								onClick={() => {
									if (
										preview?.kind === 'expression' ||
										preview?.kind === 'location'
									)
										void handleRegen(preview.assetId, preview.title)
								}}
							>
								{t('重新生成')}
							</Button>
						) : null}
					</div>
				}
			>
				{preview ? (
					<div className={styles.lightboxBody}>
						<div
							className={[
								styles.lightboxStage,
								preview.kind !== 'expression' && styles.lightboxStageWide,
								!previewUrl &&
									preview.kind !== 'styleRef' &&
									styles.lightboxStageEmpty,
							]
								.filter(Boolean)
								.join(' ')}
							style={
								preview.kind === 'styleRef'
									? { background: `var(--cover-${preview.gradientIndex})` }
									: undefined
							}
						>
							{previewUrl ? (
								<img
									key={previewVersion}
									className={styles.lightboxImg}
									src={previewUrl}
									alt={preview.title}
									onError={() =>
										setBrokenPreviewUrls((previous) => ({
											...previous,
											[previewUrl]: true,
										}))
									}
								/>
							) : preview.kind !== 'styleRef' ? (
								<div className={styles.lightboxPlaceholder}>
									<ImageIcon aria-hidden="true" size={40} strokeWidth={1.8} />
									<p className={styles.lightboxCaption}>{preview.title}</p>
									<Chip>{t('还没画')}</Chip>
								</div>
							) : null}
							{previewRegen ? (
								<div className={styles.shimmerOverlay}>
									<span className={styles.shimmerContent}>
										<Spinner size={14} />
										<span className={`ink-shimmer ${styles.shimmerText}`}>
											{t('正在生成…')}
										</span>
									</span>
								</div>
							) : null}
						</div>
						{preview.kind !== 'styleRef' && preview.description ? (
							<p className={styles.muted}>{preview.description}</p>
						) : null}
						{preview.kind !== 'styleRef' && preview.subtitle ? (
							<p className={styles.muted}>{preview.subtitle}</p>
						) : null}
						{preview.kind === 'location' && preview.variants?.length ? (
							<div className={styles.lightboxChips}>
								{preview.variants.map((variant) => (
									<Chip key={variant.id}>{nameOrSlug(variant)}</Chip>
								))}
							</div>
						) : null}
					</div>
				) : null}
			</Modal>
		</Page>
	)
}
