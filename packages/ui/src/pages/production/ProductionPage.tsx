import type { ProductionSnapshot } from '@novelive/creator/contract'
import {
	ChevronRight,
	ChevronsUp,
	CircleStop,
	Ellipsis,
	History,
	ImageOff,
	Play,
	RotateCcw,
	SquarePen,
} from 'lucide-react'
import { useState } from 'react'
import {
	Button,
	ButtonLink,
	Chip,
	ConfirmDialog,
	Dropdown,
	EmptyState,
	Page,
	ProgressBar,
	useToast,
} from '../../components'
import {
	formatChapterLabel,
	formatChapterNumeral,
	formatVolumeLabel,
} from '../../format/chapter'
import { formatErrorText, humanizeError } from '../../format/errors'
import { msg, scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { queuePosition, useProductionQueue } from '../work/queue'
import { chapterTitle, useWorkProduction } from '../work/WorkProduction'
import { ChapterRecords } from './ChapterRecords'
import { ChapterState, stepName, stepProgress, steps } from './ChapterState'
import styles from './Production.module.css'
import { ProductionNotice } from './ProductionNotice'
import { StaleAssetsDrawer, useStaleAssets } from './StaleAssets'

const t = scoped('production')

const workStatus = {
	idle: msg('空闲'),
	producing: msg('制作中'),
	stopped: msg('已停止'),
	confirm: msg('待确认'),
}

type Chapter = ProductionSnapshot['chapters'][number]

/** 四步流水线：写 › 审稿 › 演出 › 出图；当前步墨水微扫光 + 2px 下划条，已完成 / 未到的步用字重与颜色分层 */
function StepChain({ chapter, live }: { chapter: Chapter; live: boolean }) {
	if (chapter.status !== 'producing') return null
	const current = steps.indexOf(chapter.step)
	return (
		<span className={styles.steps}>
			{steps.map((step, index) => {
				const isCurrent = index === current
				const isDone = index < current
				return (
					<span className={styles.stepItem} key={step}>
						{index > 0 ? (
							<span className={styles.stepSep}>
								<ChevronRight aria-hidden="true" size={11} strokeWidth={1.8} />
							</span>
						) : null}
						{isCurrent ? (
							<span className={styles.stepActive}>
								<span className={live ? 'ink-shimmer' : styles.stepActiveIdle}>
									{t(stepName[step])}
								</span>
							</span>
						) : (
							<span className={isDone ? styles.stepDone : styles.stepUpcoming}>
								{t(stepName[step])}
							</span>
						)}
					</span>
				)
			})}
		</span>
	)
}

function ChapterRow({
	chapter,
	index,
	previous,
	live,
	onOpenRuns,
}: {
	chapter: Chapter
	index: number
	previous?: Chapter
	live: boolean
	onOpenRuns(chapterId: string): void
}) {
	const { snapshot, busy, run } = useWorkProduction()
	const { chapterId, issue, priority, status } = chapter
	const { workId, blockedChapterId, phase } = snapshot
	const title = chapterTitle(snapshot, chapterId)
	const waitForPrev =
		status === 'waiting' && (priority || previous?.status === 'producing')
	const canPrioritize =
		phase === 'producing' &&
		status === 'waiting' &&
		!priority &&
		blockedChapterId !== chapterId

	return (
		<li aria-label={title} className="hover-row">
			<div className={styles.chapterRow}>
				<span className={styles.index}>{formatChapterNumeral(index)}</span>
				<span className={styles.name}>{title}</span>
				{priority ? (
					<span className={styles.priorityMark}>
						<ChevronsUp aria-hidden="true" size={13} strokeWidth={1.8} />
						{t('优先')}
					</span>
				) : null}
				{waitForPrev ? (
					<span className={styles.waitChip}>{t('等上一章')}</span>
				) : null}
				<StepChain chapter={chapter} live={live} />
				<span className={styles.spacer} />
				{status === 'producing' && (
					<span className={styles.stepBar}>
						<ProgressBar
							value={stepProgress(chapter)}
							height={4}
							active={live}
							label={t('章节制作进度')}
						/>
					</span>
				)}
				<ChapterState chapter={chapter} />
				<span className={`row-actions ${styles.rowActions}`}>
					{status === 'published' && (
						<ButtonLink
							variant="ghost"
							size="sm"
							icon={Play}
							to={`${workRoute('play', workId)}?chapter=${encodeURIComponent(chapterId)}`}
						>
							{t('游玩')}
						</ButtonLink>
					)}
					{blockedChapterId === chapterId && (
						<Button
							variant="ghost"
							size="sm"
							icon={RotateCcw}
							disabled={busy}
							onClick={() =>
								void run('production.retryChapter', { workId, chapterId })
							}
						>
							{t('重试')}
						</Button>
					)}
					{status === 'published' && (
						<ButtonLink
							variant="ghost"
							size="sm"
							icon={SquarePen}
							to={`${workRoute('editor', workId)}?chapterId=${encodeURIComponent(chapterId)}`}
						>
							{t('编辑')}
						</ButtonLink>
					)}
					<Button
						variant="ghost"
						size="sm"
						icon={History}
						onClick={() => onOpenRuns(chapterId)}
					>
						{t('运行记录')}
					</Button>
					{status !== 'published' && canPrioritize ? (
						<Dropdown
							label={t('更多')}
							trigger={
								<Ellipsis aria-hidden="true" size={17} strokeWidth={1.8} />
							}
							items={[
								{
									label: t('优先制作'),
									icon: ChevronsUp,
									disabled: busy,
									onSelect: () =>
										void run('production.prioritizeChapter', {
											workId,
											chapterId,
										}),
								},
							]}
						/>
					) : null}
				</span>
			</div>
			{issue ? (
				<p className={`${styles.muted} ${styles.issueLine}`}>
					{formatErrorText(humanizeError(issue))}
				</p>
			) : null}
		</li>
	)
}

export function ProductionPage() {
	const { snapshot, run, busy, project } = useWorkProduction()
	const toast = useToast()
	const { workId, phase, status, blockedChapterId, chapters } = snapshot
	const queue = useProductionQueue()
	const { assets: staleAssets, resolve: resolveStale } = useStaleAssets(workId)
	const [staleOpen, setStaleOpen] = useState(false)
	const [confirmStop, setConfirmStop] = useState(false)
	const [runChapterId, setRunChapterId] = useState<string | null>(null)
	const published = chapters.filter(
		(chapter) => chapter.status === 'published',
	).length
	const flagged = chapters.filter((chapter) => chapter.issue)
	const writing = chapters.find(
		(chapter) => chapter.status === 'producing' && chapter.step !== 'draw',
	)
	const painting = chapters.find(
		(chapter) => chapter.status === 'producing' && chapter.step === 'draw',
	)
	const current = writing ?? painting
	const currentIndex = current
		? chapters.findIndex((chapter) => chapter.chapterId === current.chapterId)
		: -1
	const gate =
		phase === 'confirm-visual'
			? 'confirmVisual'
			: phase === 'confirm-first'
				? 'confirmFirst'
				: undefined
	const running = status === 'producing'
	const inactive = queue?.inactive.find(
		(work) => work.link.workId === workId && work.status === 'paused',
	)
	const crashed = inactive?.status === 'paused' && inactive.reason === 'crashed'
	const position = queuePosition(queue, workId)
	const isActiveWork = queue?.active?.link.workId === workId
	const live = queue ? isActiveWork && running : running
	const runChapter = runChapterId
		? chapters.find((chapter) => chapter.chapterId === runChapterId)
		: undefined

	async function resume() {
		if (await run('production.continue', { workId }))
			toast(t('继续制作，被中断的任务会重做一遍'), Play)
	}

	async function retryAll() {
		for (const chapter of flagged) {
			if (
				!(await run('production.retryChapter', {
					workId,
					chapterId: chapter.chapterId,
				}))
			)
				return
		}
	}

	return (
		<Page
			eyebrow={
				project &&
				t('{{series}} · {{volume}}', {
					series: project.seriesTitle,
					volume: formatVolumeLabel({ index: project.volumeIndex }),
				})
			}
			title={snapshot.title ? `${snapshot.title} · ${t('制作')}` : t('制作')}
			actions={
				<div className={styles.actions}>
					{running && (
						<Button
							variant="danger"
							icon={CircleStop}
							disabled={busy}
							onClick={() => setConfirmStop(true)}
						>
							{t('立即停止')}
						</Button>
					)}
					{status === 'stopped' && !blockedChapterId && !gate && (
						<Button
							variant="primary"
							icon={Play}
							disabled={busy}
							onClick={() => void resume()}
						>
							{t('继续制作')}
						</Button>
					)}
					{gate && (
						<ButtonLink variant="primary" to={workRoute(gate, workId)}>
							{gate === 'confirmVisual' ? t('选择主视觉') : t('确认第一章')}
						</ButtonLink>
					)}
				</div>
			}
		>
			<div className={styles.flow}>
				{crashed ? (
					<ProductionNotice
						kind="warning"
						action={
							<Button
								variant="primary"
								size="sm"
								icon={Play}
								disabled={busy}
								onClick={() => void resume()}
							>
								{t('继续制作')}
							</Button>
						}
					>
						<p>{t('上次异常退出，制作已停止')}</p>
					</ProductionNotice>
				) : null}
				{flagged.length > 0 && (
					<ProductionNotice
						kind="warning"
						key={JSON.stringify([
							blockedChapterId,
							...flagged.map(({ chapterId, issue }) => [chapterId, issue]),
						])}
						action={
							<Button
								variant="ghost"
								size="sm"
								icon={RotateCcw}
								disabled={busy}
								onClick={() => void retryAll()}
							>
								{t('全部重试')}
							</Button>
						}
					>
						<p>{t('{{length}} 章需要处理', { length: flagged.length })}</p>
						{blockedChapterId && (
							<p>{t('制作已暂停，请在失败的章节中重试。')}</p>
						)}
					</ProductionNotice>
				)}
				<section
					className={`${styles.panel} ${styles.panelBody}`}
					aria-label={t('制作状态')}
				>
					<div className={styles.statusGrid}>
						<div>
							<p className={styles.sectionLabel}>
								{currentIndex === -1 ? t('作品进度') : t('当前章节')}
							</p>
							{currentIndex === -1 ? (
								<h2 className={styles.headline}>
									{published === chapters.length && chapters.length
										? t('全部章节已发布')
										: t('等待下一个章节')}
								</h2>
							) : (
								<>
									{writing ? (
										<h2 className={styles.headline}>
											{formatChapterNumeral(currentIndex)}
											{' · '}
											{chapterTitle(snapshot, writing.chapterId)}
											<span className={styles.headlineStep}>
												{writing.status === 'producing'
													? t('（{{step}}）', {
															step: t(stepName[writing.step]),
														})
													: ''}
											</span>
										</h2>
									) : null}
									{painting ? (
										writing ? (
											<p className={styles.secondaryLine}>
												{t('同时出图：{{chapter}}', {
													chapter: formatChapterLabel({
														index:
															chapters.findIndex(
																(chapter) =>
																	chapter.chapterId === painting.chapterId,
															) + 1,
														title: chapterTitle(snapshot, painting.chapterId),
													}),
												})}
											</p>
										) : (
											<h2 className={styles.headline}>
												{formatChapterNumeral(currentIndex)}
												{' · '}
												{chapterTitle(snapshot, painting.chapterId)}
												<span className={styles.headlineStep}>
													{t('（{{step}}）', { step: t(stepName.draw) })}
												</span>
											</h2>
										)
									) : null}
								</>
							)}
							{chapters.length > 0 && (
								<ProgressBar
									value={published / chapters.length}
									label={t('已发布章节进度')}
									active={live}
								/>
							)}
							<span className={styles.muted}>
								{t('已发布 {{published}} / {{length}} 章', {
									published,
									length: chapters.length,
								})}
							</span>
						</div>
						{position !== undefined && position > 0 ? (
							<Chip>{t('排在第 {{position}} 位', { position })}</Chip>
						) : phase === 'preview' && position === undefined ? null : (
							<Chip active={position === 0 && running}>
								{t(workStatus[status])}
							</Chip>
						)}
					</div>
				</section>
				<div className={styles.sectionHead}>
					<h2 className={styles.sectionLabel} id="production-chapters">
						{project
							? t('{{volume}} · 共 {{length}} 章', {
									volume: formatVolumeLabel({
										index: project.volumeIndex,
										title: project.volumeTitle,
									}),
									length: chapters.length,
								})
							: t('章节')}
					</h2>
					{staleAssets.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							icon={ImageOff}
							onClick={() => setStaleOpen(true)}
						>
							{t('{{count}} 张图过期', { count: staleAssets.length })}
						</Button>
					) : null}
				</div>
				<section className={styles.panel} aria-labelledby="production-chapters">
					{chapters.length ? (
						<ol className={styles.rows}>
							{chapters.map((chapter, index) => (
								<ChapterRow
									key={chapter.chapterId}
									chapter={chapter}
									index={index}
									previous={index > 0 ? chapters[index - 1] : undefined}
									live={live}
									onOpenRuns={setRunChapterId}
								/>
							))}
						</ol>
					) : (
						<div className={styles.panelBody}>
							<EmptyState
								icon={SquarePen}
								title={t('暂无章节')}
								text={t('作品还没有章节。')}
							/>
						</div>
					)}
				</section>
			</div>
			<StaleAssetsDrawer
				workId={workId}
				assets={staleAssets}
				open={staleOpen}
				onClose={() => setStaleOpen(false)}
				onResolved={resolveStale}
			/>
			<ChapterRecords
				workId={workId}
				chapter={runChapter}
				title={
					runChapter
						? formatChapterLabel({
								index:
									chapters.findIndex(
										(chapter) => chapter.chapterId === runChapter.chapterId,
									) + 1,
								title: chapterTitle(snapshot, runChapter.chapterId),
							})
						: ''
				}
				open={runChapterId !== null}
				onClose={() => setRunChapterId(null)}
			/>
			<ConfirmDialog
				open={confirmStop}
				title={t('立即停止')}
				message={t(
					'取消排队任务并中断正在跑的请求，下次继续时重做被中断的部分。',
				)}
				confirmLabel={t('立即停止')}
				danger
				busy={busy}
				onConfirm={() => {
					setConfirmStop(false)
					void run('production.stop', { workId }).then((done) => {
						if (done) toast(t('已立即停止'), CircleStop)
					})
				}}
				onCancel={() => setConfirmStop(false)}
			/>
		</Page>
	)
}
