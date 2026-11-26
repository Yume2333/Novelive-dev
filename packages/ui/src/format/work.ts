import type { CommandOutput } from '@novelive/creator/contract'
import { useEffect, useState } from 'react'
import { scoped } from '../i18n'

const t = scoped('format')

type LibraryWork = CommandOutput<'library.list'>['works'][number]

/**
 * 作品 id → 展示标题。同名作品用卷标题区分；
 * 查不到的作品绝不显示 UUID，退回「已删除的作品」。
 */
export function workTitlesFromList(
	works: readonly LibraryWork[],
): Map<string, string> {
	const count = new Map<string, number>()
	for (const work of works)
		count.set(work.title, (count.get(work.title) ?? 0) + 1)
	return new Map(
		works.map((work) => {
			const volume = work.project?.volumeTitle
			const title =
				(count.get(work.title) ?? 0) > 1 && volume
					? `${work.title} · ${volume}`
					: work.title
			return [work.workId, title]
		}),
	)
}

/**
 * 作品标题展示：查不到 id（已删除或已卸载的作品）时
 * 退回本地化的「已删除的作品」，绝不渲染 UUID。
 */
export function formatWorkTitle(
	titles: ReadonlyMap<string, string>,
	workId: string | undefined,
): string {
	return (workId && titles.get(workId)) || t('已删除的作品')
}

/** React hook：书库作品 id → 展示标题的映射。 */
export function useWorkTitles(): ReadonlyMap<string, string> {
	const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map())
	useEffect(() => {
		let active = true
		const load = () => {
			window.novelive.call('library.list', {}).promise.then(
				({ works }) => {
					if (active) setTitles(workTitlesFromList(works))
				},
				() => {},
			)
		}
		load()
		const off = window.novelive.on('creator.ready', load)
		return () => {
			active = false
			off()
		}
	}, [])
	return titles
}
