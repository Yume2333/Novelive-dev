import { BookOpen, CircleCheck, Palette, Play } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ProgressBar } from '../../components/Card'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { ChapterState } from '../production/ChapterState'
import styles from '../production/Production.module.css'
import { chapterIndex } from '../production/ProductionPage'
import { ExportPackage } from './share/ExportPackage'
import local from './WorkPage.module.css'
import { chapterTitle, useWorkProduction } from './WorkProduction'

const t = scoped('work')
const pageSize = 8

function PhaseCard() {
	const { snapshot } = useWorkProduction()
	const { workId, phase, chapters, status } = snapshot
	const published = chapters.filter(
		(chapter) => chapter.status === 'published',
	).length
	if (phase === 'confirm-visual' || phase === 'confirm-first') {
		const visual = phase === 'confirm-visual'
		const Icon = visual ? Palette : Play
		return (
			<section className={`${styles.panel} ${local.phase}`}>
				<span className={local.phaseIcon}>
					<Icon aria-hidden="true" size={20} />
				</span>
				<div>
					<p className={styles.sectionLabel}>
						{visual ? t('待确认 · 确认点 1 / 2') : t('待确认 · 确认点 2 / 2')}
					</p>
					<p className={local.phaseText}>
						{visual
							? t('第一卷角色和主视觉已就绪，等待确认。')
							: t('第一章已发布，可以先试玩，再继续制作。')}
					</p>
				</div>
				<Link
					className={styles.primary}
					to={workRoute(visual ? 'confirmVisual' : 'confirmFirst', workId)}
				>
					{visual ? t('选择主视觉') : t('确认第一章')}
				</Link>
			</section>
		)
	}
	if (phase === 'done') return null
	return (
		<section className={`${styles.panel} ${local.phase}`}>
			<div>
				<p className={styles.sectionLabel}>
					{status === 'stopped' ? t('已停止') : t('制作中')}
				</p>
				<p className={local.phaseText}>
					{t('已发布 {{published}} / {{length}} 章', {
						published,
						length: chapters.length,
					})}
				</p>
				{chapters.length > 0 && (
					<ProgressBar value={published / chapters.length} />
				)}
			</div>
			<Link className={styles.button} to={workRoute('production', workId)}>
				{t('打开制作面板')}
			</Link>
		</section>
	)
}

export function WorkPage() {
	const { snapshot } = useWorkProduction()
	const { workId, summary, chapters, exportTarget } = snapshot
	const share = window.novelive.host.share
	const pickDestination = window.novelive.pickPackageDestination
	const [expanded, setExpanded] = useState(false)
	const [page, setPage] = useState(0)
	const pages = Math.max(1, Math.ceil(chapters.length / pageSize))
	const firstPublished = chapters.find(
		(chapter) => chapter.status === 'published',
	)
	const published = chapters.filter(
		(chapter) => chapter.status === 'published',
	).length
	const title = snapshot.title ?? t('作品概览')
	const visible = chapters.slice(page * pageSize, (page + 1) * pageSize)
	return (
		<Page
			title={title}
			actions={
				<div className={styles.actions}>
					<Link className={styles.button} to={workRoute('production', workId)}>
						{t('查看制作')}
					</Link>
					{share && pickDestination && exportTarget && (
						<ExportPackage
							api={share}
							pickDestination={pickDestination}
							workId={workId}
							{...exportTarget}
						/>
					)}
					{firstPublished && (
						<Link className={styles.primary} to={workRoute('play', workId)}>
							<Play aria-hidden="true" size={16} />
							{t('开始游玩')}
						</Link>
					)}
				</div>
			}
		>
			<div className={styles.flow}>
				<section className={`${styles.panel} ${local.hero}`}>
					<span className={local.cover} aria-hidden="true">
						<BookOpen size={28} strokeWidth={1.6} />
					</span>
					<div className={local.heroText}>
						<p className={local.heroTitle}>{title}</p>
						<span className={styles.muted}>
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
							<button
								className={styles.ghost}
								type="button"
								aria-expanded={expanded}
								onClick={() => setExpanded(!expanded)}
							>
								{expanded ? t('收起') : t('展开简介')}
							</button>
						)}
					</div>
				</section>
				<PhaseCard />
				<h2 className={styles.sectionLabel} id="work-chapters">
					{t('章节目录 · 共 {{length}} 章', { length: chapters.length })}
				</h2>
				<section className={styles.panel} aria-labelledby="work-chapters">
					{chapters.length ? (
						<ol className={styles.rows}>
							{visible.map((chapter, offset) => {
								const index = page * pageSize + offset
								const name = chapterTitle(snapshot, chapter.chapterId)
								return (
									<li className={styles.chapterRow} key={chapter.chapterId}>
										<span className={styles.index}>{chapterIndex(index)}</span>
										<span className={styles.name}>{name}</span>
										<span className={styles.spacer} />
										<ChapterState chapter={chapter} />
									</li>
								)
							})}
						</ol>
					) : (
						<p className={`${styles.muted} ${styles.panelBody}`}>
							{t('暂无章节')}
						</p>
					)}
				</section>
				{pages > 1 && (
					<nav className={local.pagination} aria-label={t('章节分页')}>
						{Array.from({ length: pages }, (_, index) => (
							<button
								// biome-ignore lint/suspicious/noArrayIndexKey: page numbers are positional
								key={index}
								type="button"
								className={styles.ghost}
								aria-current={index === page ? 'page' : undefined}
								onClick={() => setPage(index)}
							>
								{index + 1}
							</button>
						))}
					</nav>
				)}
			</div>
		</Page>
	)
}
