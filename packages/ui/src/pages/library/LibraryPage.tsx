import type { CommandOutput } from '@novelive/creator/contract'
import { FileUp, LibraryBig } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, Page, PageAction } from '../../components/Page'
import { productionRoutes, workRoute } from '../../routes/production'
import styles from './LibraryPage.module.css'
import { ImportPackage } from './share/ImportPackage'

export function LibraryPage() {
	const [library, setLibrary] = useState<CommandOutput<'library.list'>>()
	const [error, setError] = useState(false)
	const [revision, setRevision] = useState(0)
	const share = window.novelive.host.share

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

	return (
		<Page
			title="书库"
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
						导入原文
					</PageAction>
				</div>
			}
		>
			{error ? (
				<p role="alert">无法读取书库</p>
			) : !library ? (
				<p>正在读取书库</p>
			) : library.works.length === 0 && library.unreadableCount === 0 ? (
				<EmptyState
					icon={LibraryBig}
					title="书库还是空的"
					text="还没有作品"
					card
				/>
			) : (
				<section aria-labelledby="library-projects" className={styles.projects}>
					<h2 id="library-projects">我的工程</h2>
					{library.unreadableCount > 0 && (
						<p role="alert">有 {library.unreadableCount} 部作品无法读取</p>
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
											已发布 {published} / {chapters} 章
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</Page>
	)
}
