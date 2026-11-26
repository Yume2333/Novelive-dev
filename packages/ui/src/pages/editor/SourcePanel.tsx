import { WandSparkles, X } from 'lucide-react'
import type { RefObject } from 'react'
import { IconButton } from '../../components/Button'
import { SectionLabel } from '../../components/Card'
import { ScrollArea } from '../../components/ScrollArea'
import {
	formatParagraphLabel,
	formatParagraphRange,
} from '../../format/chapter'
import { scoped } from '../../i18n'

const t = scoped('editor')

export interface SourcePanelProps {
	paragraphs: readonly { id: string; text: string }[]
	activeSourceIds: readonly string[]
	disabled: boolean
	viewportRef?: RefObject<HTMLDivElement | null>
	onClose(): void
	onJumpParagraph(paragraphId: string): void
	onAskParagraph(paragraph: { id: string; text: string }): void
}

export function SourcePanel({
	paragraphs,
	activeSourceIds,
	disabled,
	viewportRef,
	onClose,
	onJumpParagraph,
	onAskParagraph,
}: SourcePanelProps) {
	const range =
		activeSourceIds.length === 1
			? formatParagraphLabel(activeSourceIds[0])
			: activeSourceIds.length > 1
				? formatParagraphRange(
						activeSourceIds[0],
						activeSourceIds[activeSourceIds.length - 1],
					)
				: ''

	return (
		<>
			<div className="editor-source-head">
				<SectionLabel>{t('原文对照')}</SectionLabel>
				<IconButton
					icon={X}
					label={t('收起')}
					size={28}
					iconSize={16}
					onClick={onClose}
				/>
			</div>
			{range ? (
				<p className="editor-source-range">{t('原文{{range}}', { range })}</p>
			) : null}
			<ScrollArea className="editor-source" viewportRef={viewportRef}>
				{paragraphs.map((paragraph) => {
					const linked = activeSourceIds.includes(paragraph.id)
					return (
						<div
							key={paragraph.id}
							className="hover-row editor-source-card"
							data-linked={linked || undefined}
						>
							<button
								type="button"
								className="editor-source-item"
								disabled={disabled}
								aria-pressed={linked}
								onClick={() => onJumpParagraph(paragraph.id)}
							>
								{paragraph.text}
							</button>
							<div className="row-actions editor-source-actions">
								<button
									type="button"
									className="editor-source-ask label-caps label-caps-zh"
									disabled={disabled}
									onClick={() => onAskParagraph(paragraph)}
								>
									<WandSparkles
										aria-hidden="true"
										size={12}
										strokeWidth={1.8}
									/>
									{t('让 Agent 按这段修改')}
								</button>
							</div>
						</div>
					)
				})}
			</ScrollArea>
		</>
	)
}
