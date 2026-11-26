import {
	type CommandOutput,
	productionQueueEvent,
} from '@novelive/creator/contract'
import { useEffect, useState } from 'react'

export type Queue = CommandOutput<'production.getQueue'>

/**
 * 队列的展示位置：正在制作的 active 作品是 0；
 * 排队中的作品是「排在第 N 位」直接展示的 1 起序数
 * （active 存在时排队第 i 项展示为 i + 2，否则 i + 1）；
 * 不在队列（或队列还没读到）时返回 undefined。
 * 调用方原样展示返回值，不再加 1。
 */
export function queuePosition(
	queue: Queue | undefined,
	workId: string,
): number | undefined {
	if (!queue) return undefined
	if (queue.active?.link.workId === workId) return 0
	const index = queue.queued.findIndex((work) => work.link.workId === workId)
	if (index === -1) return undefined
	return queue.active ? index + 2 : index + 1
}

/** 实时制作队列：首次读取 + production.queue 事件推送；创作端就绪重读、断开清空。 */
export function useProductionQueue(): Queue | undefined {
	const [queue, setQueue] = useState<Queue>()
	useEffect(() => {
		let active = true
		let revision = 0
		const load = () => {
			const current = ++revision
			void window.novelive.call('production.getQueue', {}).promise.then(
				(next) => {
					if (active && current === revision) setQueue(next)
				},
				() => {},
			)
		}
		const offEvent = window.novelive.on('event', (event) => {
			if (event.scope !== 'app' || !productionQueueEvent.check(event.event))
				return
			revision++
			setQueue(event.event.payload)
		})
		const offReady = window.novelive.on('creator.ready', load)
		const offDown = window.novelive.on('creator.down', () => {
			revision++
			setQueue(undefined)
		})
		void window.novelive.host.appState().then((state) => {
			if (active && revision === 0 && state.creator === 'ready') load()
		})
		return () => {
			active = false
			offEvent()
			offReady()
			offDown()
		}
	}, [])
	return queue
}
