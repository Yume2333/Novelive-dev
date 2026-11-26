import { useId, useRef, useState } from 'react'
import { ScrollArea } from '../../components/ScrollArea'
import { scoped } from '../../i18n'
import { type SpeakerNames, speakerDisplayName } from './display'
import { parseRich, parseSentenceLines } from './sentence-lines'

const t = scoped('editor')

/** 菜单条目只保留说话的文字：标记取标记内文字（嵌套递归展开），注音取正文，停顿舍弃。 */
function plainText(src: string): string {
	return parseRich(src)
		.map((seg) => {
			if (seg.kind === 'wait') return ''
			if (seg.kind === 'text' || seg.kind === 'ruby') return seg.text
			return seg.text.includes('{') ? plainText(seg.text) : seg.text
		})
		.join('')
		.trim()
}

export function JumpPoints({
	script,
	disabled,
	speakerNames,
	onJump,
}: {
	script: string
	disabled: boolean
	speakerNames: SpeakerNames
	onJump: (line: number) => void
}) {
	const id = useId()
	const trigger = useRef<HTMLButtonElement>(null)
	const menu = useRef<HTMLDivElement>(null)
	const [expanded, setExpanded] = useState(false)
	const [position, setPosition] = useState({ top: 0, left: 0 })
	const points = script.split(/\r\n?|\n/).flatMap((raw, index) => {
		const parsed = parseSentenceLines(raw)[0]
		if (!parsed?.lineId) return []
		const text = plainText(parsed.text)
		if (!text) return []
		const speaker = parsed.displayAs?.trim()
			? parsed.displayAs.trim()
			: parsed.speaker
				? speakerDisplayName(speakerNames, parsed.speaker)
				: ''
		return [
			{
				id: parsed.lineId,
				line: index + 1,
				text: speaker ? t('{{speaker}}：{{text}}', { speaker, text }) : text,
			},
		]
	})
	function positionMenu() {
		const bounds = trigger.current?.getBoundingClientRect()
		if (!bounds) return
		setPosition({
			top: Math.max(
				16,
				Math.min(
					bounds.bottom + 4,
					window.innerHeight - Math.min(256, window.innerHeight * 0.4) - 16,
				),
			),
			left: Math.max(16, Math.min(bounds.left, window.innerWidth - 496)),
		})
	}
	return (
		<div className="editor-jumps">
			<span>{t('快捷位置')}</span>
			<button
				ref={trigger}
				type="button"
				aria-label={t('快捷位置')}
				aria-haspopup="menu"
				aria-expanded={expanded}
				popoverTarget={id}
				disabled={disabled || !points.length}
				onClick={positionMenu}
				onKeyDown={(event) => {
					if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
					event.preventDefault()
					positionMenu()
					menu.current?.showPopover()
				}}
			>
				{t('跳转到句子')}
			</button>
			<div
				ref={menu}
				id={id}
				popover="auto"
				role="menu"
				aria-label={t('快捷位置')}
				className="editor-jump-menu"
				style={position}
				onToggle={() => {
					const open = !!menu.current?.matches(':popover-open')
					setExpanded(open)
					if (open)
						menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
				}}
				onKeyDown={(event) => {
					const items = [
						...event.currentTarget.querySelectorAll<HTMLButtonElement>(
							'[role="menuitem"]',
						),
					]
					const active = document.activeElement
					const current =
						active instanceof HTMLButtonElement ? items.indexOf(active) : -1
					const next =
						event.key === 'Home'
							? 0
							: event.key === 'End'
								? items.length - 1
								: event.key === 'ArrowDown'
									? (current + 1) % items.length
									: event.key === 'ArrowUp'
										? (current - 1 + items.length) % items.length
										: undefined
					if (next !== undefined) {
						event.preventDefault()
						items[next]?.focus()
					} else if (event.key === 'Escape') {
						event.preventDefault()
						menu.current?.hidePopover()
						trigger.current?.focus()
					} else if (event.key === 'Tab') menu.current?.hidePopover()
				}}
			>
				<ScrollArea className="editor-jump-scroll">
					{points.map((point) => (
						<button
							key={point.id}
							type="button"
							role="menuitem"
							className="editor-jump-item"
							onClick={() => {
								menu.current?.hidePopover()
								onJump(point.line)
							}}
						>
							{point.line} · {point.text}
						</button>
					))}
				</ScrollArea>
			</div>
		</div>
	)
}
