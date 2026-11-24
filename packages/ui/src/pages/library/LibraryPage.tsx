import type { CommandOutput } from '@novelive/creator/contract'
import {
	CheckCircle2,
	Clock,
	LibraryBig,
	NotebookPen,
	PlayCircle,
	Plus,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { ProgressBar } from '../../components/Card'
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

function WorkCard({
	id,
	title,
	to,
	status,
	icon: Icon,
	published,
	chapters,
	meta,
}: {
	id: string
	title: string
	to?: string
	status: string
	icon: typeof Clock
	published: number
	chapters: number
	meta?: ReactNode
}) {
	const body = (
		<>
			<span className={`cover-tilt ${styles.cover}`}>
				<GradientCover seed={id} compact />
			</span>
			<span className={styles.cardBody}>
				<strong className={`headline ${styles.title}`} id={`work-title-${id}`}>
					{title}
				</strong>
				<span className={styles.status} id={`work-progress-${id}`}>
					<Icon aria-hidden="true" size={12} strokeWidth={2} />
					{status}
				</span>
				<span className={styles.progressRow}>
					<ProgressBar value={chapters ? published / chapters : 0} height={5} />
					<span>
						{published}/{chapters}
					</span>
				</span>
				{meta}
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

export function LibraryPage() {
	const { refreshLibrary } = useOutletContext<{ refreshLibrary(): void }>()
	const [loaded, setLibrary] = useState<CommandOutput<'library.list'>>()
	const [error, setError] = useState(false)
	const [revision, setRevision] = useState(0)
	const [searchParams] = useSearchParams()
	const [tab, setTab] = useState<Tab>(
		searchParams.get('tab') === 'imported' ? 'imported' : 'projects',
	)
	const share = window.novelive.host.share
	const installed = window.novelive.host.installed
	const [packages, setPackages] = useState<
		Awaited<ReturnType<NonNullable<typeof installed>['list']>>
	>([])

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

	const library =
		loaded ??
		(packages.length > 0 ? { works: [], unreadableCount: 0 } : undefined)

	return (
		<Page
			title={t('书库')}
			action={
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
						/>
					)}
					<PageAction icon={Plus} to={productionRoutes.import}>
						{t('新建工程')}
					</PageAction>
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
				<EmptyState
					icon={LibraryBig}
					title={t('书库还是空的')}
					text={t('导入一部小说原文，Novelive 会把它做成可以游玩的视觉小说。')}
					card
					actions={
						<Link className="nl-btn nl-btn-ghost" to="/welcome">
							{t('开始引导')}
						</Link>
					}
				/>
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
												{group.title}
												<span className={styles.groupPath}>{group.key}</span>
											</h2>
										)}
										{group.volumes.map((volume) => (
											<div key={volume.key} className={styles.volume}>
												{volume.title && (
													<h3 className={styles.volumeTitle}>{volume.title}</h3>
												)}
												<ul className={styles.grid}>
													{volume.works.map(
														({ workId, title, published, chapters }) => (
															<li key={workId}>
																<WorkCard
																	id={workId}
																	title={title}
																	to={workRoute('work', workId)}
																	icon={
																		published === chapters && chapters
																			? CheckCircle2
																			: Clock
																	}
																	status={t(
																		'已发布 {{published}} / {{chapters}} 章',
																		{
																			published,
																			chapters,
																		},
																	)}
																	published={published}
																	chapters={chapters}
																/>
															</li>
														),
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
													icon={PlayCircle}
													status={t(
														'v{{version}} · 已发布 {{published}} / {{chapters}} 章',
														{
															version,
															published,
															chapters,
														},
													)}
													published={published}
													chapters={chapters}
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
