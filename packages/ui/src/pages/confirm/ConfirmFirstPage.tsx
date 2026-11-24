import { Info, Play } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { ChapterState } from '../production/ChapterState'
import styles from '../production/Production.module.css'
import { chapterTitle, useWorkProduction } from '../work/WorkProduction'
import local from './Confirm.module.css'

const t = scoped('confirm')

export function ConfirmFirstPage() {
	const { snapshot, run, busy } = useWorkProduction()
	const navigate = useNavigate()
	const { workId, phase, blockedChapterId } = snapshot
	const first = snapshot.chapters[0]
	const ready = phase === 'confirm-first' && first?.status === 'published'

	return (
		<Page
			eyebrow={
				snapshot.title
					? `${snapshot.title} · ${t('确认点 2 / 2')}`
					: t('确认点 2 / 2')
			}
			title={
				<span className={local.title}>
					{t('第一章成品')}
					<Info
						className={local.info}
						size={16}
						aria-label={t('确认后其余章节在后台按卷连续做，做完一章即可游玩。')}
					/>
				</span>
			}
			actions={
				ready && (
					<div className={styles.actions}>
						<Link className={styles.button} to={workRoute('play', workId)}>
							<Play aria-hidden="true" size={16} />
							{t('试玩第一章')}
						</Link>
						<button
							className={styles.primary}
							type="button"
							disabled={busy || Boolean(blockedChapterId)}
							onClick={async () => {
								if (await run('production.continue', { workId }))
									navigate(workRoute('production', workId))
							}}
						>
							{t('继续制作')}
						</button>
					</div>
				)
			}
		>
			<div className={styles.flow}>
				{ready ? (
					<>
						<p className={styles.sectionLabel}>
							{t('第 1 章 · {{value}}', {
								value: chapterTitle(snapshot, first.chapterId),
							})}
							<span className={local.aside}>
								{t('已发布，可以试玩，准备好后再手动继续制作。')}
							</span>
						</p>
						<section
							className={`${styles.panel} ${local.chapter}`}
							aria-label={t('第一章成品')}
						>
							<span className={local.art} aria-hidden="true">
								<span>{t('第一章')}</span>
							</span>
							<div className={styles.panelBody}>
								<div className={styles.sectionHead}>
									<h2 className={local.cardTitle}>
										{chapterTitle(snapshot, first.chapterId)}
									</h2>
									<ChapterState chapter={first} />
								</div>
								{first.issue && <p className={styles.muted}>{first.issue}</p>}
							</div>
						</section>
					</>
				) : (
					<section className={`${styles.panel} ${styles.panelBody}`}>
						<p className={styles.muted}>{t('目前没有待确认的第一章。')}</p>
						<Link className={styles.ghost} to={workRoute('production', workId)}>
							{t('查看制作')}
						</Link>
					</section>
				)}
			</div>
		</Page>
	)
}
