import type { CommandOutput } from '@novelive/creator/contract'
import { FileUp, LibraryBig } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, Page, PageAction } from '../../components/Page'
import { productionRoutes, workRoute } from '../../routes/production'
import styles from './LibraryPage.module.css'

export function LibraryPage() {
	const [library, setLibrary] = useState<CommandOutput<'library.list'>>()
	const [error, setError] = useState(false)

	useEffect(() => {
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
	}, [])

	return (
		<Page
			title="书库"
			action={
				<PageAction icon={FileUp} to={productionRoutes.import}>
					导入原文
				</PageAction>
			}
		>
			{error ? (
				<p role="alert">无法读取书库</p>
			) : !library ? (
				<p>正在读取书库</p>
			) : library.works.length === 0 ? (
				<EmptyState
					icon={LibraryBig}
					title="书库还是空的"
					text="还没有作品"
					card
				/>
			) : (
				<section aria-label="我的工程" className={styles.projects}>
					{library.works.map(({ workId, title }) => (
						<PageAction
							key={workId}
							icon={LibraryBig}
							to={workRoute('work', workId)}
						>
							{title}
						</PageAction>
					))}
				</section>
			)}
		</Page>
	)
}
