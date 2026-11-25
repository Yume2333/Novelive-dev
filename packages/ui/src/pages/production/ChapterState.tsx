import type { ProductionSnapshot } from '@novelive/creator/contract'
import { ChapterStatusMark, Tooltip } from '../../components'
import { msg } from '../../i18n'

type Chapter = ProductionSnapshot['chapters'][number]
export const stepName = {
	write: msg('写剧本'),
	review: msg('审稿'),
	stage: msg('演出'),
	draw: msg('出图'),
}
export const steps = Object.keys(stepName) as (keyof typeof stepName)[]

export function stepProgress(chapter: Chapter) {
	if (chapter.status === 'published') return 1
	if (chapter.status !== 'producing') return 0
	return (steps.indexOf(chapter.step) + 0.5) / steps.length
}

/** 章状态标记：复用控件库 ChapterStatusMark；「需要处理」原因放进 Tooltip，不占用行内空间 */
export function ChapterState({ chapter }: { chapter: Chapter }) {
	if (chapter.issue)
		return (
			<Tooltip text={chapter.issue}>
				<span style={{ display: 'inline-flex' }}>
					<ChapterStatusMark status={chapter.status} attention />
				</span>
			</Tooltip>
		)
	return <ChapterStatusMark status={chapter.status} />
}
