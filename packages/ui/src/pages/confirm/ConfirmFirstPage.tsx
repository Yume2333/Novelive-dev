import { Link, useNavigate } from 'react-router-dom'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { ChapterState } from '../production/ChapterState'
import styles from '../production/Production.module.css'
import { chapterTitle, useWorkProduction } from '../work/WorkProduction'

const t = scoped('confirm')

export function ConfirmFirstPage() {
	const { snapshot, run, busy } = useWorkProduction()
	const navigate = useNavigate()
	const { workId, phase, blockedChapterId } = snapshot
	const first = snapshot.chapters[0]

	return (
		<Page title={t('确认第一章')}>
			<div className={styles.stack}>
				{phase === 'confirm-first' && first?.status === 'published' ? (
					<>
						<p className={styles.lead}>
							{t(
								'确认点 2 / 2 · 第一章已发布。先试玩，准备好后再手动继续制作。',
							)}
						</p>
						<section className={styles.card} aria-label={t('第一章成品')}>
							<div className={styles.row}>
								<h2>{chapterTitle(snapshot, first.chapterId)}</h2>
								<ChapterState chapter={first} />
							</div>
							{first.issue && <p>{first.issue}</p>}
						</section>
						<div className={styles.actions}>
							<Link className={styles.button} to={workRoute('play', workId)}>
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
					</>
				) : (
					<>
						<p>{t('目前没有待确认的第一章。')}</p>
						<Link to={workRoute('production', workId)}>{t('查看制作')}</Link>
					</>
				)}
			</div>
		</Page>
	)
}
