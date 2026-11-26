import {
	type CommandOutput,
	productionQueueEvent,
} from '@novelive/creator/contract'
import {
	BookOpen,
	ChevronDown,
	ChevronsUp,
	CircleAlert,
	CircleCheck,
	Clapperboard,
	Ellipsis,
	Package,
	Palette,
	Play,
	Settings2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import {
	Card,
	ChapterStatusMark,
	Chip,
	ProgressBar,
	SectionLabel,
} from '../../components/Card'
import { Dropdown } from '../../components/Dropdown'
import { Pagination, Tooltip } from '../../components/Extended'
import { GradientCover } from '../../components/GradientCover'
import { Page } from '../../components/Page'
import { msg, scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { chapterIndex } from '../production/ProductionPage'
import { ExportPackage } from './share/ExportPackage'
import local from './WorkPage.module.css'
import { chapterTitle, useWorkProduction } from './WorkProduction'
import { WorkSettingsDrawer } from './WorkSettings'

const t = scoped('work')
const pageSize = 8

const stepLabel = {
	write: msg('写剧本'),
	review: msg('审稿'),
	stage: msg('演出'),
	draw: msg('出图'),
} as const

type Queue = CommandOutput<'production.getQueue'>

/** 队列位置：active 为 0，queued 依次后排；不在队列返回 undefined。 */
function queuePosition(queue: Queue | undefined, workId: string) {
	if (!queue) return undefined
	if (queue.active?.link.workId === workId) return 0
	const index = queue.queued.findIndex((work) => work.link.workId === workId)
	return index === -1 ? undefined : index + 1
}

function useProductionQueue() {
	const [queue, setQueue] = useState<Queue>()
	useEffect(() => {
		let active = true
		let revision = 0
		const load = () => {
			const current = ++revision
			void window.novelive.call('production.getQueue', {}).promise.then(
				(next) => {
					if (active && current === revision) setQueue(next)
				},
				() => {},
			)
		}
		const offEvent = window.novelive.on('event', (event) => {
			if (event.scope !== 'app' || !productionQueueEvent.check(event.event))
				return
			revision++
			setQueue(event.event.payload)
		})
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			revision++
			setQueue(undefined)
		})
		void window.novelive.host.appState().then((state) => {
			if (active && revision === 0 && state.creator === 'ready') load()
		})
		return () => {
			active = false
			offEvent()
			offReady()
			offDown()
		}
	}, [])
	return queue
}

function QueueChip({
	position,
	running,
}: {
	position?: number
	running: boolean
}) {
	if (position === 0 && running) return <Chip active>{t('正在处理')}</Chip>
	if (position !== undefined && position > 0)
		return <Chip>{t('排在第 {{value}} 位', { value: position + 1 })}</Chip>
	return <Chip>{t('已停止')}</Chip>
}

function PhaseCard({ position }: { position?: number }) {
	const { snapshot } = useWorkProduction()
	const { workId, phase, chapters, status } = snapshot
	const published = chapters.filter(
		(chapter) => chapter.status === 'published',
	).length
	const running = status === 'producing'
	if (phase === 'confirm-visual' || phase === 'confirm-first') {
		const visual = phase === 'confirm-visual'
		const Icon = visual ? Palette : Play
		return (
			<Card className={local.phase}>
				<span className={local.phaseIcon} data-tone="attention">
					<Icon aria-hidden="true" size={22} strokeWidth={1.8} />
				</span>
				<div>
					<p
						className={`label-caps label-caps-zh ${local.phaseLabel}`}
						data-tone="attention"
					>
						{visual ? t('待确认 · 确认点 1 / 2') : t('待确认 · 确认点 2 / 2')}
					</p>
					<p className={local.phaseText}>
						{visual
							? t('第一卷角色和主视觉已就绪，等待确认。')
							: t('第一章已发布，可以先试玩，再继续制作。')}
					</p>
				</div>
				<Link
					className={local.primaryLink}
					to={workRoute(visual ? 'confirmVisual' : 'confirmFirst', workId)}
				>
					{visual ? t('选择主视觉') : t('确认第一章')}
				</Link>
			</Card>
		)
	}
	if (phase === 'done') {
		return (
			<Card className={local.phase}>
				<span className={local.phaseIcon} data-tone="success">
					<CircleCheck aria-hidden="true" size={22} strokeWidth={1.8} />
				</span>
				<div>
					<p className={local.phaseText}>{t('全部章节已发布')}</p>
				</div>
			</Card>
		)
	}
	if (phase === 'preview') {
		return (
			<Card className={local.phase}>
				<span className={local.phaseIcon}>
					<BookOpen aria-hidden="true" size={22} strokeWidth={1.8} />
				</span>
				<div>
					<p className={`label-caps label-caps-zh ${local.phaseLabel}`}>
						{t('当前阶段 · 预览')}
					</p>
					<p className={local.phaseText}>{t('尚未开始制作')}</p>
					{chapters.length > 0 && (
						<div className={local.phaseProgress}>
							<ProgressBar value={published / chapters.length} height={6} />
						</div>
					)}
				</div>
				<QueueChip position={position} running={running} />
				<Link className={local.buttonLink} to={workRoute('production', workId)}>
					<Clapperboard aria-hidden="true" size={16} strokeWidth={1.8} />
					{t('打开制作面板')}
				</Link>
			</Card>
		)
	}
	if (phase === 'producing') {
		const current = chapters.find((chapter) => chapter.status === 'producing')
		const attention = chapters.filter((chapter) => chapter.issue).length
		return (
			<Card className={local.phase}>
				<span className={local.phaseIcon}>
					<Clapperboard aria-hidden="true" size={22} strokeWidth={1.8} />
				</span>
				<div>
					<p className={`label-caps label-caps-zh ${local.phaseLabel}`}>
						{running
							? t('制作中 · 正在制作')
							: status === 'stopped'
								? t('制作中 · 已停止')
								: position !== undefined && position > 0
									? t('制作中 · 排在第 {{value}} 位', { value: position + 1 })
									: t('制作中')}
					</p>
					<p className={local.phaseText}>
						{current
							? chapterTitle(snapshot, current.chapterId)
							: t('等待下一个章节')}
						{current?.status === 'producing' && (
							<span className={local.phaseStep}>
								{t('（{{value}}）', {
									value: t(stepLabel[current.step]),
								})}
							</span>
						)}
					</p>
					{chapters.length > 0 && (
						<div className={local.phaseProgress}>
							<ProgressBar
								value={published / chapters.length}
								height={6}
								active={running}
							/>
						</div>
					)}
					{attention > 0 && (
						<p className={local.phaseAttention}>
							{t('{{count}} 章需要处理', { count: attention })}
						</p>
					)}
				</div>
				<Link className={local.buttonLink} to={workRoute('production', workId)}>
					<Clapperboard aria-hidden="true" size={16} strokeWidth={1.8} />
					{t('打开制作面板')}
				</Link>
			</Card>
		)
	}
	return null
}

function HeroCard() {
	const { snapshot, project } = useWorkProduction()
	const { workId, summary, chapters } = snapshot
	const [expanded, setExpanded] = useState(false)
	const [reading, setReading] = useState<{ chapter: number; value: number }>()
	const published = chapters.filter(
		(chapter) => chapter.status === 'published',
	).length
	const title = snapshot.title ?? t('作品概览')

	useEffect(() => {
		let active = true
		const api = window.novelive.host.progress
		if (!api) return
		void api.load(workId).then(
			(progress) => {
				if (!active || !progress?.mainline) return
				const index = chapters.findIndex(
					(chapter) => chapter.chapterId === progress.mainline?.chapterId,
				)
				if (index === -1 || !chapters.length) return
				setReading({
					chapter: index + 1,
					value: (index + 1) / chapters.length,
				})
			},
			() => {},
		)
		return () => {
			active = false
		}
	}, [workId, chapters])

	return (
		<Card className={local.hero}>
			<span className={`cover-tilt ${local.cover}`}>
				<GradientCover seed={workId} title={snapshot.title} />
			</span>
			<div className={local.heroText}>
				{project && (
					<p className={`label-caps label-caps-zh ${local.heroEyebrow}`}>
						{t('{{series}} · 第 {{index}} 卷 · {{volume}}', {
							series: project.seriesTitle,
							index: project.volumeIndex,
							volume: project.volumeTitle,
						})}
					</p>
				)}
				<p className={local.heroTitle}>{title}</p>
				<span className={local.muted}>
					<CircleCheck aria-hidden="true" size={13} />{' '}
					{t('已发布 {{published}} / {{length}} 章', {
						published,
						length: chapters.length,
					})}
				</span>
				{summary && (
					<p className={local.synopsis} data-expanded={expanded}>
						{summary}
					</p>
				)}
				{summary && (
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={expanded}
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? t('收起') : t('展开简介')}
						<span className="nl-chevron" data-open={expanded}>
							<ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
						</span>
					</Button>
				)}
				{reading && (
					<div className={local.reading}>
						<p className="label-caps label-caps-zh">
							{t('读到第 {{value}} 章', { value: reading.chapter })}
						</p>
						<ProgressBar value={reading.value} height={5} />
					</div>
				)}
			</div>
		</Card>
	)
}

function ChapterRow({
	chapter,
	index,
}: {
	chapter: CommandOutput<'production.get'>['chapters'][number]
	index: number
}) {
	const { snapshot } = useWorkProduction()
	const title = chapterTitle(snapshot, chapter.chapterId)
	const playable = chapter.status === 'published'
	const body = (
		<>
			<span className={local.index}>{chapterIndex(index)}</span>
			<span className={local.name}>{title}</span>
			{chapter.priority && chapter.status === 'waiting' && (
				<span className={`label-caps label-caps-zh ${local.priority}`}>
					<ChevronsUp aria-hidden="true" size={13} strokeWidth={1.8} />
					{t('优先')}
				</span>
			)}
			{chapter.status === 'producing' && (
				<span className={local.step}>{t(stepLabel[chapter.step])}</span>
			)}
			{chapter.issue && (
				<Tooltip text={chapter.issue}>
					<span className={local.issue}>
						<CircleAlert aria-hidden="true" size={13} strokeWidth={1.8} />
						{chapter.issue}
					</span>
				</Tooltip>
			)}
			<span className={local.spacer} />
			<ChapterStatusMark status={chapter.status} attention={!!chapter.issue} />
			<span className={`row-actions ${local.rowActions}`}>
				{playable && (
					<span className={local.playAffordance} aria-hidden="true">
						<Play size={13} strokeWidth={1.8} />
						{t('游玩')}
					</span>
				)}
			</span>
		</>
	)
	return (
		<li aria-label={title}>
			{playable ? (
				<Link
					className={`hover-row ${local.chapterRow}`}
					data-playable="true"
					to={`${workRoute('play', snapshot.workId)}?chapter=${encodeURIComponent(chapter.chapterId)}`}
				>
					{body}
				</Link>
			) : (
				<div className={`hover-row ${local.chapterRow}`}>{body}</div>
			)}
		</li>
	)
}

export function WorkPage() {
	const { snapshot, project } = useWorkProduction()
	const { workId, chapters, exportTarget } = snapshot
	const share = window.novelive.host.share
	const pickDestination = window.novelive.pickPackageDestination
	const queue = useProductionQueue()
	const [page, setPage] = useState(1)
	const pages = Math.max(1, Math.ceil(chapters.length / pageSize))
	const current = Math.min(page, pages)
	const firstPublished = chapters.find(
		(chapter) => chapter.status === 'published',
	)
	const title = snapshot.title ?? t('作品概览')
	const visible = chapters.slice((current - 1) * pageSize, current * pageSize)
	const [exporting, setExporting] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const canExport = Boolean(share && pickDestination && exportTarget)
	return (
		<Page
			title={title}
			actions={
				<div className={local.actions}>
					<Dropdown
						label={t('更多')}
						className={local.buttonLink}
						trigger={
							<>
								<Ellipsis aria-hidden="true" size={16} />
								{t('更多')}
							</>
						}
						items={[
							...(canExport
								? [
										{
											label: t('导出作品包'),
											icon: Package,
											onSelect: () => setExporting(true),
										},
									]
								: []),
							{
								label: t('作品设置'),
								icon: Settings2,
								onSelect: () => setSettingsOpen(true),
							},
						]}
					/>
					{exporting && share && pickDestination && exportTarget && (
						<ExportPackage
							api={share}
							pickDestination={pickDestination}
							workId={workId}
							workTitle={snapshot.title}
							volumeTitle={project?.volumeTitle}
							seriesTitle={project?.seriesTitle}
							onClose={() => setExporting(false)}
							{...exportTarget}
						/>
					)}
					{firstPublished && (
						<Link className={local.primaryLink} to={workRoute('play', workId)}>
							<Play aria-hidden="true" size={16} />
							{t('开始游玩')}
						</Link>
					)}
				</div>
			}
		>
			<div className={local.flow}>
				<HeroCard />
				<PhaseCard position={queuePosition(queue, workId)} />
				<div className={local.sectionLabel} id="work-chapters">
					<SectionLabel>
						{t('章节目录 · 共 {{length}} 章', { length: chapters.length })}
					</SectionLabel>
				</div>
				<Card aria-labelledby="work-chapters">
					{chapters.length ? (
						<ol className={local.rows}>
							{visible.map((chapter, offset) => (
								<ChapterRow
									key={chapter.chapterId}
									chapter={chapter}
									index={(current - 1) * pageSize + offset}
								/>
							))}
						</ol>
					) : (
						<p className={`${local.muted} ${local.panelBody}`}>
							{t('暂无章节')}
						</p>
					)}
				</Card>
				{pages > 1 && (
					<nav className={local.pagination} aria-label={t('章节分页')}>
						<Pagination page={current} total={pages} onChange={setPage} />
					</nav>
				)}
			</div>
			<WorkSettingsDrawer
				open={settingsOpen}
				onClose={() => setSettingsOpen(false)}
			/>
		</Page>
	)
}
