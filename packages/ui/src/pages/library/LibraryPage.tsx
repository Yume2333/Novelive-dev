import type { CommandOutput } from '@novelive/creator/contract'
import { FileUp, LibraryBig } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, Page, PageAction } from '../../components/Page'
import { scoped } from '../../i18n'
import { productionRoutes, workRoute } from '../../routes/production'
import styles from './LibraryPage.module.css'
import { ImportPackage } from './share/ImportPackage'

const t = scoped('library')

export function LibraryPage() {
	const [library, setLibrary] = useState<CommandOutput<'library.list'>>()
	const [error, setError] = useState(false)
	const [revision, setRevision] = useState(0)
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
		const off = window.novelive.on('creator.ready', load)
		void window.novelive.host.appState().then(
			(state) => {
				if (state.creator === 'ready' && !pending) load()
			},
			() => {},
		)
		return () => {
			active = false
			off()
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
							onImported={() => setRevision((n) => n + 1)}
						/>
					)}
					<PageAction icon={FileUp} to={productionRoutes.import}>
						{t('导入原文')}
					</PageAction>
				</div>
			}
		>
			{error ? (
				<p role="alert">{t('无法读取书库')}</p>
			) : !library ? (
				<p>{t('正在读取书库')}</p>
			) : library.works.length === 0 &&
				library.unreadableCount === 0 &&
				packages.length === 0 ? (
				<EmptyState
					icon={LibraryBig}
					title={t('书库还是空的')}
					text={t('还没有作品')}
					card
				/>
			) : library.works.length > 0 || library.unreadableCount > 0 ? (
				<section aria-labelledby="library-projects" className={styles.projects}>
					<h2 id="library-projects">{t('我的工程')}</h2>
					{library.unreadableCount > 0 && (
						<p role="alert">
							{t('有 {{unreadableCount}} 部作品无法读取', {
								unreadableCount: library.unreadableCount,
							})}
						</p>
					)}
					<ul className={styles.grid}>
						{library.works.map(({ workId, title, published, chapters }) => (
							<li key={workId}>
								<Link
									className={styles.card}
									to={workRoute('work', workId)}
									aria-labelledby={`work-title-${workId}`}
									aria-describedby={`work-progress-${workId}`}
								>
									<span className={styles.cover}>
										<LibraryBig size={24} aria-hidden="true" />
									</span>
									<span>
										<strong id={`work-title-${workId}`}>{title}</strong>
										<span
											className={styles.progress}
											id={`work-progress-${workId}`}
										>
											{t('已发布 {{published}} / {{chapters}} 章', {
												published,
												chapters,
											})}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			) : null}
			{packages.length > 0 && (
				<section aria-labelledby="library-packages" className={styles.projects}>
					<h2 id="library-packages">{t('导入的作品')}</h2>
					<ul className={styles.grid}>
						{packages.map(({ workId, title, version, published, chapters }) => {
							const label = (
								<>
									<LibraryBig size={24} aria-hidden="true" />
									<span>
										<strong>{title}</strong>
										<span className={styles.progress}>
											{t(
												'v{{version}} · 已发布 {{published}} / {{chapters}} 章',
												{ version, published, chapters },
											)}
										</span>
									</span>
								</>
							)
							return (
								<li key={workId}>
									{published ? (
										<Link
											className={styles.card}
											to={`/package/${workId}/${version}`}
										>
											{label}
										</Link>
									) : (
										<div className={styles.card}>{label}</div>
									)}
								</li>
							)
						})}
					</ul>
				</section>
			)}
		</Page>
	)
}
