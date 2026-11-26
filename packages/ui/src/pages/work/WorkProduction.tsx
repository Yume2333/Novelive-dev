import {
	type CommandInput,
	type CommandOutput,
	type ProductionSnapshot,
	productionSnapshotEvent,
} from '@novelive/creator/contract'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useOutletContext, useParams } from 'react-router-dom'
import { ErrorNotice, LoadingState } from '../../components/Feedback'
import { Page } from '../../components/Page'
import { formatChapterLabel } from '../../format/chapter'
import { humanizeError } from '../../format/errors'
import { scoped } from '../../i18n'

const t = scoped('work')

type Action =
	| 'production.confirmVisual'
	| 'production.continue'
	| 'production.stop'
	| 'production.prioritizeChapter'
	| 'production.retryChapter'

/** `production.get` 调用句柄：页面只需要 promise 与取消能力。 */
type ProductionGetHandle = {
	promise: Promise<ProductionSnapshot>
	cancel(): void
}

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

/** 章节标题：优先后端提供的标题，缺失时退回「第 N 章」序数，绝不显示章节 id。 */
export const chapterTitle = (snapshot: ProductionSnapshot, chapterId: string) =>
	snapshot.chapterTitles?.[chapterId] ??
	formatChapterLabel({
		index:
			snapshot.chapters.findIndex(
				(chapter) => chapter.chapterId === chapterId,
			) + 1,
	})

function humanize(failure: unknown) {
	const error = humanizeError(failure)
	// 未识别的输入会退回通用句；在制作状态页换成带着页面语境的文案，detail 保留。
	if (error.message === humanizeError(undefined).message)
		return { ...error, message: t('无法读取制作状态，请重试。') }
	return error
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
	const [failure, setFailure] = useState<unknown>()
	const [offline, setOffline] = useState<string>()
	const [busy, setBusy] = useState(false)
	const eventVersion = useRef(0)
	const action = useRef(false)

	useEffect(() => {
		let active = true
		let loadVersion = 0
		let pending: ProductionGetHandle | undefined
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
						setFailure(undefined)
						setOffline(undefined)
					}
				},
				(error) => {
					if (
						active &&
						current === loadVersion &&
						before === eventVersion.current
					) {
						setFailure(error)
						setOffline(undefined)
					}
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
				setFailure(undefined)
				setOffline(undefined)
			},
		)
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			loadVersion++
			eventVersion.current++
			setSnapshot(undefined)
			setFailure(undefined)
			setOffline(t('创作端已断开，等待重新连接。'))
		})
		void window.novelive.host.appState().then(
			(state) => {
				if (!active || loadVersion !== 0) return
				if (state.creator === 'ready') load()
				else if (state.creator !== 'starting') setOffline(t('创作端未连接。'))
			},
			(error) => {
				if (active) {
					setFailure(error)
					setOffline(undefined)
				}
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
		setFailure(undefined)
		setOffline(undefined)
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
		} catch (error) {
			setFailure(error)
			return false
		} finally {
			action.current = false
			setBusy(false)
		}
	}

	const error = offline
		? { message: offline }
		: failure !== undefined
			? humanize(failure)
			: undefined

	return (
		<>
			{error && (
				<Page title={t('制作提示')}>
					<ErrorNotice
						error={error}
						onRetry={snapshot ? undefined : retry}
						retryLabel={snapshot ? undefined : t('重新读取')}
					/>
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
						<LoadingState text={t('正在读取制作状态…')} />
					</Page>
				)
			)}
		</>
	)
}
