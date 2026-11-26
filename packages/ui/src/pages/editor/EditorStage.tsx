import type { WorkSettings } from '@novelive/format/model'
import {
	ChevronLeft,
	ChevronRight,
	Pause,
	Play,
	Square,
	User,
} from 'lucide-react'
import { type RefObject, useState } from 'react'
import { Spinner } from '../../components/Button'
import { Tooltip } from '../../components/Extended'
import { scoped } from '../../i18n'
import {
	type AssetLabelInfo,
	expressionLabel,
	speakerDisplayName,
} from './display'
import { RichText } from './RichText'
import type { StageSnapshot } from './scene-assets'
import type { SentenceLine } from './sentence-lines'

const t = scoped('editor')

export interface EditorStageProps {
	stageRef: RefObject<HTMLDivElement | null>
	stageBoxRef: RefObject<HTMLElement | null>
	snapshot: StageSnapshot
	sentences: readonly SentenceLine[]
	activeSentence: SentenceLine | undefined
	speakerNames: Readonly<Record<string, string>>
	assetInfo: AssetLabelInfo
	customMarks: WorkSettings['customMarks']
	playing: boolean
	paused: boolean
	regenerating: 'bg' | 'portrait' | null
	onSelectLine(lineNumber: number): void
	onTogglePause(): void
	onStopPlay(): void
	onCastClick?(charId: string): void
}

export function EditorStage({
	stageRef,
	stageBoxRef,
	snapshot,
	sentences,
	activeSentence,
	speakerNames,
	assetInfo,
	customMarks,
	playing,
	paused,
	regenerating,
	onSelectLine,
	onTogglePause,
	onStopPlay,
	onCastClick,
}: EditorStageProps) {
	const [brokenUrls, setBrokenUrls] = useState<ReadonlySet<string>>(new Set())
	const markBroken = (url: string) =>
		setBrokenUrls((prev) => {
			const next = new Set(prev)
			next.add(url)
			return next
		})

	const activeIdx = activeSentence
		? sentences.findIndex((s) => s.lineNumber === activeSentence.lineNumber)
		: -1

	const backdrop = snapshot.cg ?? snapshot.background
	const isSpeakerLine =
		activeSentence?.kind === 'dialogue' || activeSentence?.kind === 'inner'
	const shownSpeaker =
		activeSentence?.displayAs ||
		(activeSentence?.speaker
			? speakerDisplayName(speakerNames, activeSentence.speaker)
			: undefined)

	return (
		<section
			className="editor-stage"
			ref={stageBoxRef}
			aria-label={t('舞台预览')}
		>
			<div
				className="editor-stage-surface"
				ref={stageRef}
				data-playing={playing ? 'true' : undefined}
				data-paused={playing && paused ? 'true' : undefined}
			/>
			{(!playing || paused) && (
				<>
					<div className="editor-stage-bg-fallback" />
					{backdrop?.path && !brokenUrls.has(backdrop.path) && (
						<img
							className="editor-stage-bg-img"
							src={window.novelive.resourceUrl(backdrop.path)}
							alt=""
							onError={() => markBroken(backdrop.path ?? '')}
						/>
					)}
					<div className="editor-stage-horizon" />
					{snapshot.cast.map((member, index) => {
						const speaking =
							isSpeakerLine && activeSentence?.speaker === member.charId
						const shownName =
							speaking && activeSentence?.displayAs
								? activeSentence.displayAs
								: speakerDisplayName(speakerNames, member.charId)
						const expr = expressionLabel(member.assetId, assetInfo)
						const badgeText = expr ? `${shownName} · ${expr}` : shownName
						return (
							<button
								key={member.slot}
								type="button"
								className="editor-stage-cast"
								data-slot={member.slot}
								data-speaking={speaking ? 'true' : 'false'}
								aria-label={badgeText}
								onClick={() => onCastClick?.(member.charId)}
							>
								{member.path && !brokenUrls.has(member.path) ? (
									<img
										className="editor-stage-portrait"
										src={window.novelive.resourceUrl(member.path)}
										alt=""
										onError={() => markBroken(member.path ?? '')}
									/>
								) : (
									<span
										className="editor-stage-silhouette"
										data-tint={index % 3}
									>
										<User aria-hidden="true" size={30} strokeWidth={1.8} />
									</span>
								)}
								<span className="editor-stage-cast-badge label-caps label-caps-zh">
									{badgeText}
								</span>
							</button>
						)
					})}
					{snapshot.sceneTitle ? (
						<span className="editor-stage-chip editor-stage-chip-left label-caps label-caps-zh">
							{snapshot.sceneTitle}
						</span>
					) : null}
					{sentences.length > 0 && (
						<span className="editor-stage-chip editor-stage-chip-right label-caps">
							{activeIdx + 1} / {sentences.length}
						</span>
					)}
					<button
						type="button"
						className="editor-stage-nav-btn editor-stage-nav-prev"
						aria-label={t('上一句')}
						disabled={activeIdx <= 0}
						onClick={() => {
							if (activeIdx > 0) {
								const prev = sentences[activeIdx - 1]
								if (prev) onSelectLine(prev.lineNumber)
							}
						}}
					>
						<ChevronLeft aria-hidden="true" size={18} strokeWidth={1.8} />
					</button>
					<button
						type="button"
						className="editor-stage-nav-btn editor-stage-nav-next"
						aria-label={t('下一句')}
						disabled={activeIdx < 0 || activeIdx >= sentences.length - 1}
						onClick={() => {
							if (activeIdx >= 0 && activeIdx < sentences.length - 1) {
								const next = sentences[activeIdx + 1]
								if (next) onSelectLine(next.lineNumber)
							}
						}}
					>
						<ChevronRight aria-hidden="true" size={18} strokeWidth={1.8} />
					</button>
					{activeSentence?.kind === 'caption' ? (
						<div className="editor-stage-caption-wrap">
							<span className="editor-stage-caption">
								<RichText
									src={activeSentence.text}
									base="stage"
									customMarks={customMarks}
								/>
							</span>
						</div>
					) : activeSentence ? (
						<div className="editor-stage-dialogue">
							{isSpeakerLine && shownSpeaker ? (
								<div className="editor-stage-speaker-tab">
									{shownSpeaker}
									{activeSentence.kind === 'inner' ? t(' · 内心') : ''}
								</div>
							) : null}
							<div
								className="editor-stage-textbox"
								data-kind={activeSentence.kind}
								data-has-speaker={isSpeakerLine ? 'true' : undefined}
							>
								<RichText
									src={activeSentence.text}
									base="stage"
									customMarks={customMarks}
								/>
							</div>
						</div>
					) : null}
				</>
			)}
			{playing && (
				<div className="editor-stage-playback">
					<Tooltip text={paused ? t('继续') : t('暂停')}>
						<button
							type="button"
							className="editor-stage-pill-btn"
							onClick={onTogglePause}
						>
							{paused ? (
								<Play aria-hidden="true" size={15} strokeWidth={1.8} />
							) : (
								<Pause aria-hidden="true" size={15} strokeWidth={1.8} />
							)}
							<span className="label-caps label-caps-zh">
								{paused ? t('继续') : t('暂停')}
							</span>
						</button>
					</Tooltip>
					<Tooltip text={t('停止（Esc）')}>
						<button
							type="button"
							className="editor-stage-pill-btn"
							aria-label={t('停止预览')}
							onClick={onStopPlay}
						>
							<Square aria-hidden="true" size={15} strokeWidth={1.8} />
							<span className="label-caps label-caps-zh">{t('停止')}</span>
						</button>
					</Tooltip>
				</div>
			)}
			{regenerating !== null && (
				<div
					className="editor-stage-shimmer"
					role="status"
					aria-label={t('正在生成图片')}
				>
					<div className="editor-stage-shimmer-inner">
						<Spinner size={14} />
						<span className="label-caps label-caps-zh">
							{regenerating === 'bg' ? t('正在重绘背景…') : t('正在重绘立绘…')}
						</span>
					</div>
				</div>
			)}
		</section>
	)
}
