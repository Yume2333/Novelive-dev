import {
	type CommandOutput,
	installedProgressKey,
	productionQueueEvent,
} from '@novelive/creator/contract'
import {
	BookMarked,
	BookOpen,
	CircleAlert,
	CircleCheck,
	Clapperboard,
	LibraryBig,
	NotebookPen,
	Palette,
	Play,
	PlayCircle,
	Plus,
	Upload,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
	Link,
	useNavigate,
	useOutletContext,
	useSearchParams,
} from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card, Chip, ProgressBar } from '../../components/Card'
import { GradientCover } from '../../components/GradientCover'
import { EmptyState, Page, PageAction } from '../../components/Page'
import { Tabs, tabPanel } from '../../components/Tabs'
import { scoped } from '../../i18n'
import { productionRoutes, workRoute } from '../../routes/production'
import type { LibraryWork } from '../../shell/AppShell'
import styles from './LibraryPage.module.css'
import { ImportPackage } from './share/ImportPackage'

const t = scoped('library')

type Tab = 'projects' | 'imported'
type Queue = CommandOutput<'production.getQueue'>

interface Group {
	key: string
	title?: string
	volumes: { key: string; title?: string; works: LibraryWork[] }[]
}

/** Series are grouped per project folder: different projects may reuse a series id. */
function groupWorks(works: LibraryWork[]) {
	const groups: Group[] = []
	const loose: LibraryWork[] = []
	for (const work of works) {
		const project = work.project
		if (!project) {
			loose.push(work)
			continue
		}
		let group = groups.find(({ key }) => key === project.directory)
		if (!group) {
			group = {
				key: project.directory,
				title: project.seriesTitle,
				volumes: [],
			}
			groups.push(group)
		}
		let volume = group.volumes.find(({ key }) => key === project.volumeId)
		if (!volume) {
			volume = {
				key: project.volumeId,
				title: t('第 {{index}} 卷 · {{title}}', {
					index: project.volumeIndex,
					title: project.volumeTitle,
				}),
				works: [],
			}
			group.volumes.push(volume)
		}
		volume.works.push(work)
	}
	for (const group of groups)
		group.volumes.sort(
			(a, b) =>
				(a.works[0]?.project?.volumeIndex ?? 0) -
				(b.works[0]?.project?.volumeIndex ?? 0),
		)
	if (loose.length)
		groups.push({ key: '', volumes: [{ key: '', works: loose }] })
	return groups
}

/** 队列里一部作品的状态：确认点、暂停（需要处理）、制作中或已完成。 */
type QueueState =
	| { kind: 'confirm-visual' | 'confirm-first' }
	| { kind: 'attention' }
	| { kind: 'producing' }
	| { kind: 'done' }

function queueState(
	queue: Queue | undefined,
	workId: string,
): QueueState | null {
	if (!queue) return null
	if (queue.active?.link.workId === workId) return { kind: 'producing' }
	if (queue.queued.some((work) => work.link.workId === workId))
		return { kind: 'producing' }
	for (const work of queue.inactive) {
		if (work.link.workId !== workId) continue
		if (work.status === 'awaiting_confirm')
			return {
				kind:
					work.reason === 'confirm_visual' ? 'confirm-visual' : 'confirm-first',
			}
		if (work.status === 'paused')
			return work.reason === 'stopped' || work.reason === 'crashed'
				? null
				: { kind: 'attention' }
		if (work.status === 'done') return { kind: 'done' }
	}
	return null
}

interface ReadingProgress {
	read: number
	total: number
}

function statusLine({
	state,
	published,
	chapters,
	imported,
}: {
	state: QueueState | null
	published: number
	chapters: number
	imported?: boolean
}) {
	const counts = { published, chapters }
	if (imported)
		return {
			text: t('共 {{chapters}} 章', { chapters }),
			icon: BookOpen,
			tone: 'quiet' as const,
		}
	if (state?.kind === 'confirm-visual')
		return {
			text: t('等你确认角色设定'),
			icon: Palette,
			tone: 'attention' as const,
		}
	if (state?.kind === 'confirm-first')
		return {
			text: t('第一章等你过目'),
			icon: Play,
			tone: 'attention' as const,
		}
	if (state?.kind === 'attention')
		return {
			text: t('已发布 {{published}} / {{chapters}} 章 · 需要处理', counts),
			icon: CircleAlert,
			tone: 'attention' as const,
		}
	if (state?.kind === 'done' || (chapters > 0 && published === chapters))
		return {
			text: t('全部 {{chapters}} 章已发布', { chapters }),
			icon: CircleCheck,
			tone: 'done' as const,
		}
	if (chapters === 0)
		return {
			text: t('全书预览中'),
			icon: BookOpen,
			tone: 'quiet' as const,
		}
	return {
		text: t('已发布 {{published}} / {{chapters}} 章', counts),
		icon: state?.kind === 'producing' ? Clapperboard : BookOpen,
		tone: 'quiet' as const,
	}
}

function WorkCard({
	id,
	title,
	to,
	published,
	chapters,
	state,
	reading,
	badge,
	imported,
}: {
	id: string
	title: string
	to?: string
	published: number
	chapters: number
	state?: QueueState | null
	reading?: ReadingProgress
	badge?: ReactNode
	imported?: boolean
}) {
	const line = statusLine({
		state: state ?? null,
		published,
		chapters,
		imported,
	})
	const Icon = line.icon
	const producing = state?.kind === 'producing'
	const showProduction = !imported && chapters > 0 && (!reading || producing)
	const body = (
		<>
			<span className={`cover-tilt ${styles.cover}`}>
				<GradientCover seed={id} compact />
			</span>
			<span className={styles.cardBody}>
				<span className={styles.cardHead}>
					<span className={styles.cardTitles}>
						<strong
							className={`headline ${styles.title}`}
							id={`work-title-${id}`}
						>
							{title}
						</strong>
					</span>
					{badge ? <span className={styles.cardBadge}>{badge}</span> : null}
				</span>
				<div className={styles.cardFoot}>
					<span
						className={`${styles.status} ${
							line.tone === 'attention'
								? styles.statusAttention
								: line.tone === 'done'
									? styles.statusDone
									: styles.statusQuiet
						}`}
						id={`work-progress-${id}`}
					>
						<Icon aria-hidden="true" size={14} strokeWidth={1.8} />
						{line.text}
					</span>
					{showProduction ? (
						<ProgressBar
							value={chapters ? published / chapters : 0}
							height={5}
							active={producing}
						/>
					) : null}
					{reading && !producing ? (
						<>
							<ProgressBar value={reading.read / reading.total} height={5} />
							<span className={styles.readingCaption}>
								<span>
									{t('已读 {{read}} / {{total}} 章', {
										read: reading.read,
										total: reading.total,
									})}
								</span>
								<span className={styles.readingPercent}>
									{Math.round((reading.read / reading.total) * 100)}%
								</span>
							</span>
						</>
					) : null}
				</div>
			</span>
		</>
	)
	return to ? (
		<Link
			className={`glass-panel nl-card-interactive ${styles.card}`}
			to={to}
			aria-labelledby={`work-title-${id}`}
			aria-describedby={`work-progress-${id}`}
		>
			{body}
		</Link>
	) : (
		<div className={`glass-panel ${styles.card}`}>{body}</div>
	)
}

const emptyLibrary: CommandOutput<'library.list'> = {
	works: [],
	unreadableCount: 0,
}

export function LibraryPage() {
	const { refreshLibrary } = useOutletContext<{ refreshLibrary(): void }>()
	const [loaded, setLibrary] = useState<CommandOutput<'library.list'>>()
	const [error, setError] = useState(false)
	const [revision, setRevision] = useState(0)
	const [searchParams] = useSearchParams()
	const [tab, setTab] = useState<Tab>(
		searchParams.get('tab') === 'imported' ? 'imported' : 'projects',
	)
	const navigate = useNavigate()
	const share = window.novelive.host.share
	const installed = window.novelive.host.installed
	const progressApi = window.novelive.host.progress
	const [packages, setPackages] = useState<
		Awaited<ReturnType<NonNullable<typeof installed>['list']>>
	>([])
	const [queue, setQueue] = useState<Queue>()
	const [reading, setReading] = useState<Record<string, ReadingProgress>>({})
	const importInspect = useRef<(() => void) | null>(null)

	useEffect(() => {
		void revision
		let active = true
		let pending:
			| ReturnType<typeof window.novelive.call<'library.list'>>
			| undefined
		function load() {
			if (!active) return
			pending?.cancel()
			const request = window.novelive.call('library.list', {})
			pending = request
			void request.promise.then(
				(value) => {
					if (!active || pending !== request) return
					setLibrary(value)
					setError(false)
				},
				() => {
					if (active && pending === request) setError(true)
				},
			)
		}
		const failed = () =>
			void window.novelive.host.appState().then(
				(state) => {
					if (active && state.creator === 'failed') setError(true)
				},
				() => {},
			)
		const off = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', failed)
		void window.novelive.host.appState().then(
			(state) => {
				if (state.creator === 'ready' && !pending) load()
				else if (active && state.creator === 'failed') setError(true)
			},
			() => {},
		)
		return () => {
			active = false
			off()
			offDown()
			pending?.cancel()
		}
	}, [revision])
	useEffect(() => {
		void revision
		if (!installed) return
		let active = true
		void installed.list().then(
			(works) => {
				if (active) setPackages(works)
			},
			() => {
				if (active) setError(true)
			},
		)
		return () => {
			active = false
		}
	}, [revision, installed])
	useEffect(() => {
		void revision
		let active = true
		let revisionNow = 0
		const load = () => {
			const current = ++revisionNow
			void window.novelive.call('production.getQueue', {}).promise.then(
				(next) => {
					if (active && current === revisionNow) setQueue(next)
				},
				() => {},
			)
		}
		const offEvent = window.novelive.on('event', (envelope) => {
			if (
				envelope.scope !== 'app' ||
				!productionQueueEvent.check(envelope.event)
			)
				return
			revisionNow++
			setQueue(envelope.event.payload)
		})
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			revisionNow++
			setQueue(undefined)
		})
		void window.novelive.host.appState().then((state) => {
			if (active && revisionNow === 0 && state.creator === 'ready') load()
		})
		return () => {
			active = false
			offEvent()
			offReady()
			offDown()
		}
	}, [revision])

	const library = loaded ?? (packages.length > 0 ? emptyLibrary : undefined)

	useEffect(() => {
		if (!progressApi || !library) return
		let active = true
		const keys: { key: string; total: number }[] = []
		for (const work of library.works)
			keys.push({ key: work.workId, total: work.published })
		for (const pack of packages)
			keys.push({
				key: installedProgressKey(pack.workId, pack.version),
				total: pack.published,
			})
		void Promise.allSettled(
			keys.map(({ key, total }) =>
				progressApi.load(key).then((progress) => ({ key, total, progress })),
			),
		).then((results) => {
			if (!active) return
			const next: Record<string, ReadingProgress> = {}
			for (const result of results) {
				if (result.status !== 'fulfilled' || !result.value.progress) continue
				const { key, total, progress } = result.value
				if (!total) continue
				const chapters = new Set(
					progress.read.map((sentence) => sentence.chapterId),
				)
				if (progress.mainline) chapters.add(progress.mainline.chapterId)
				const read = Math.min(chapters.size, total)
				if (read > 0) next[key] = { read, total }
			}
			setReading(next)
		})
		return () => {
			active = false
		}
	}, [progressApi, library, packages])

	const empty =
		library !== undefined &&
		library.works.length === 0 &&
		library.unreadableCount === 0 &&
		packages.length === 0

	return (
		<Page
			title={t('书库')}
			actions={
				<div className={styles.actions}>
					{share && (
						<ImportPackage
							api={share}
							pickPackage={async () =>
								(await window.novelive.pickFiles('package'))[0]
							}
							pickProjectFolder={() => window.novelive.pickFolder()}
							onImported={() => {
								setRevision((n) => n + 1)
								refreshLibrary()
								setTab('imported')
							}}
							inspectRef={importInspect}
							hideTrigger={empty}
						/>
					)}
					{!empty && (
						<PageAction icon={Plus} to={productionRoutes.import}>
							{t('新建工程')}
						</PageAction>
					)}
				</div>
			}
		>
			{error && !library ? (
				<p role="alert">{t('无法读取书库')}</p>
			) : !library ? (
				<p role="status">{t('正在读取书库')}</p>
			) : library.works.length === 0 &&
				library.unreadableCount === 0 &&
				packages.length === 0 ? (
				<Card>
					<EmptyState
						icon={LibraryBig}
						title={t('书库还是空的')}
						text={t('新建工程开始改编小说，或导入 .novelive 作品包直接游玩')}
						actions={
							<>
								<PageAction icon={Plus} to={productionRoutes.import}>
									{t('新建工程')}
								</PageAction>
								{share && (
									<Button
										icon={Upload}
										onClick={() => importInspect.current?.()}
									>
										{t('导入作品包')}
									</Button>
								)}
							</>
						}
					/>
					<div className={styles.emptyGuide}>
						<button
							type="button"
							className="label-caps label-caps-zh"
							onClick={() => navigate('/welcome')}
						>
							{t('重看首次引导')} →
						</button>
					</div>
				</Card>
			) : (
				<>
					<div className={styles.tabs}>
						<Tabs<Tab>
							id="library"
							label={t('书库')}
							active={tab}
							onChange={setTab}
							tabs={[
								{ key: 'projects', label: t('我的工程'), icon: NotebookPen },
								{ key: 'imported', label: t('导入的作品'), icon: PlayCircle },
							]}
						/>
					</div>
					{tab === 'projects' ? (
						<section
							{...tabPanel('library', 'projects')}
							className={styles.projects}
						>
							{library.unreadableCount > 0 && (
								<p role="alert" className={styles.alert}>
									{t('有 {{unreadableCount}} 部作品无法读取', {
										unreadableCount: library.unreadableCount,
									})}
								</p>
							)}
							{!loaded ? (
								error ? (
									<p role="alert">{t('无法读取书库')}</p>
								) : (
									<p role="status">{t('正在读取书库')}</p>
								)
							) : library.works.length === 0 ? (
								<EmptyState icon={NotebookPen} text={t('还没有作品')} card />
							) : (
								groupWorks(library.works as LibraryWork[]).map((group) => (
									<div key={group.key} className={styles.group}>
										{group.title && (
											<h2
												className={`label-caps label-caps-zh ${styles.groupTitle}`}
											>
												<BookMarked
													aria-hidden="true"
													size={15}
													strokeWidth={1.8}
												/>
												{group.title}
												<span className={styles.groupPath}>· {group.key}</span>
											</h2>
										)}
										{group.volumes.map((volume) => (
											<div key={volume.key} className={styles.volume}>
												{volume.title && (
													<h3 className={styles.volumeTitle}>{volume.title}</h3>
												)}
												<ul className={styles.grid}>
													{volume.works.map(
														({ workId, title, published, chapters }) => {
															const state = queueState(queue, workId)
															return (
																<li key={workId}>
																	<WorkCard
																		id={workId}
																		title={title}
																		to={workRoute('work', workId)}
																		published={published}
																		chapters={chapters}
																		state={state}
																		reading={reading[workId]}
																		badge={
																			state?.kind === 'confirm-visual' ? (
																				<Chip active>{t('确认点 1')}</Chip>
																			) : state?.kind === 'confirm-first' ? (
																				<Chip active>{t('确认点 2')}</Chip>
																			) : undefined
																		}
																	/>
																</li>
															)
														},
													)}
												</ul>
											</div>
										))}
									</div>
								))
							)}
						</section>
					) : (
						<section
							{...tabPanel('library', 'imported')}
							className={styles.projects}
						>
							{packages.length === 0 ? (
								<EmptyState
									icon={PlayCircle}
									text={t('还没有导入的作品')}
									card
								/>
							) : (
								<ul className={styles.grid}>
									{packages.map(
										({ workId, title, version, published, chapters }) => (
											<li key={workId}>
												<WorkCard
													id={workId}
													title={title}
													to={
														published
															? `/package/${workId}/${version}`
															: undefined
													}
													published={published}
													chapters={chapters}
													reading={
														reading[installedProgressKey(workId, version)]
													}
													badge={<Chip>v{version}</Chip>}
													imported
												/>
											</li>
										),
									)}
								</ul>
							)}
						</section>
					)}
				</>
			)}
		</Page>
	)
}
