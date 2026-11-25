import {
	type CommandInput,
	type CommandOutput,
	type ProductionSnapshot,
	productionSnapshotEvent,
} from '@novelive/creator/contract'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useOutletContext, useParams } from 'react-router-dom'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'

const t = scoped('work')

type Action =
	| 'production.confirmVisual'
	| 'production.continue'
	| 'production.stop'
	| 'production.prioritizeChapter'
	| 'production.retryChapter'

type WorkProductionContext = {
	snapshot: ProductionSnapshot
	busy: boolean
	/** `library.list` 中这部作品的系列／卷；已安装作品包没有。 */
	project?: CommandOutput<'library.list'>['works'][number]['project']
	run<K extends Action>(command: K, input: CommandInput<K>): Promise<boolean>
}

export function useWorkProduction() {
	return useOutletContext<WorkProductionContext>()
}

export const chapterTitle = (snapshot: ProductionSnapshot, chapterId: string) =>
	snapshot.chapterTitles?.[chapterId] ??
	t('第 {{value}} 章', {
		value:
			snapshot.chapters.findIndex(
				(chapter) => chapter.chapterId === chapterId,
			) + 1,
	})

function errorMessage(error: unknown) {
	return error &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
		? error.message
		: t('无法读取制作状态，请重试。')
}

export function WorkProduction() {
	const { id } = useParams()
	const [attempt, setAttempt] = useState(0)
	if (!id) return null
	return (
		<Projection
			key={`${id}/${attempt}`}
			workId={id}
			retry={() => setAttempt((n) => n + 1)}
		/>
	)
}

function Projection({ workId, retry }: { workId: string; retry(): void }) {
	const [snapshot, setSnapshot] = useState<ProductionSnapshot>()
	const [project, setProject] = useState<WorkProductionContext['project']>()
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const eventVersion = useRef(0)
	const action = useRef(false)

	useEffect(() => {
		let active = true
		let loadVersion = 0
		let pending:
			| ReturnType<typeof window.novelive.call<'production.get'>>
			| undefined
		function load() {
			const current = ++loadVersion
			const before = eventVersion.current
			pending?.cancel()
			pending = window.novelive.call('production.get', { workId })
			void pending.promise.then(
				(next) => {
					if (
						active &&
						current === loadVersion &&
						before === eventVersion.current
					) {
						setSnapshot(next)
						setError('')
					}
				},
				(failure) => {
					if (
						active &&
						current === loadVersion &&
						before === eventVersion.current
					)
						setError(errorMessage(failure))
				},
			)
		}
		const offEvent = window.novelive.on(
			'event',
			({ scope, scopeId, event }) => {
				if (
					scope !== 'work' ||
					scopeId !== workId ||
					!productionSnapshotEvent.check(event) ||
					event.payload.workId !== workId
				)
					return
				eventVersion.current++
				setSnapshot(event.payload)
				setError('')
			},
		)
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			loadVersion++
			eventVersion.current++
			setSnapshot(undefined)
			setError(t('创作端已断开，等待重新连接。'))
		})
		void window.novelive.host.appState().then(
			(state) => {
				if (!active || loadVersion !== 0) return
				if (state.creator === 'ready') load()
				else if (state.creator !== 'starting') setError(t('创作端未连接。'))
			},
			(failure) => {
				if (active) setError(errorMessage(failure))
			},
		)
		return () => {
			active = false
			pending?.cancel()
			offReady()
			offDown()
			offEvent()
		}
	}, [workId])

	useEffect(() => {
		const request = window.novelive.call('library.list', {})
		request.promise.then(
			(library) =>
				setProject(
					library.works.find((work) => work.workId === workId)?.project,
				),
			() => setProject(undefined),
		)
		return () => request.cancel()
	}, [workId])

	async function run<K extends Action>(command: K, input: CommandInput<K>) {
		if (action.current) return false
		action.current = true
		setBusy(true)
		setError('')
		const before = eventVersion.current
		try {
			const result = await window.novelive.call<Action>(command, input).promise
			const next =
				'phase' in result
					? result
					: before === eventVersion.current
						? await window.novelive.call('production.get', { workId }).promise
						: undefined
			if (next && eventVersion.current === before) setSnapshot(next)
			return true
		} catch (failure) {
			setError(errorMessage(failure))
			return false
		} finally {
			action.current = false
			setBusy(false)
		}
	}

	return (
		<>
			{error && (
				<Page title={t('制作提示')}>
					<p role="alert">{error}</p>
					{!snapshot && (
						<button type="button" onClick={retry}>
							{t('重新读取')}
						</button>
					)}
				</Page>
			)}
			{snapshot ? (
				<Outlet
					context={
						{ snapshot, busy, run, project } satisfies WorkProductionContext
					}
				/>
			) : (
				!error && (
					<Page title={t('作品')}>
						<p role="status">{t('正在读取制作状态…')}</p>
					</Page>
				)
			)}
		</>
	)
}
