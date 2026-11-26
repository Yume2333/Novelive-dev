import type { AssetRegistry } from '@novelive/format/model'
import { parseScript, type Scene } from '@novelive/format/script'
import { Check, Ellipsis, Image, NotebookPen, PlayCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, buttonClasses } from '../../components/Button'
import { Card, SectionLabel } from '../../components/Card'
import { Dropdown } from '../../components/Dropdown'
import {
	ButtonLink,
	ErrorNotice,
	LoadingState,
} from '../../components/Feedback'
import { InfoTooltip } from '../../components/InfoTooltip'
import { EmptyState, Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { formatChapterLabel, formatVolumeLabel } from '../../format/chapter'
import { formatLanguage } from '../../format/language'
import { msg, scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { useWorkProduction } from '../work/WorkProduction'
import local from './Confirm.module.css'

const t = scoped('confirm')

type RegistryEntry = AssetRegistry['entries'][number]

type SceneCard = {
	key: string
	title: string
	desc: string
	images: string
	art?: string
}

const imageActions = new Set(['bg', 'fg', 'cg', 'show', 'face', 'costume'])
const kindNames: Record<RegistryEntry['type'], string> = {
	location: msg('背景'),
	cg: msg('CG'),
	character: msg('立绘'),
	expression: msg('立绘'),
	variant: msg('立绘'),
}

function sceneCard(
	scene: Scene,
	index: number,
	entries: Map<string, RegistryEntry>,
): SceneCard {
	const kinds = new Map<RegistryEntry['type'], number>()
	let art: string | undefined
	for (const line of scene.lines) {
		if (line.type !== 'action' || !imageActions.has(line.name)) continue
		const asset = line.args.asset
		if (typeof asset !== 'string') continue
		const entry = entries.get(asset)
		if (line.name === 'bg' && !art && entry && entry.status !== 'pending')
			art = window.novelive.resourceUrl(entry.path)
		if (entry) kinds.set(entry.type, (kinds.get(entry.type) ?? 0) + 1)
	}
	const text = scene.lines
		.filter((line) => line.type === 'text')
		.map((line) =>
			line.content
				.filter((part) => part.type === 'text')
				.map((part) => part.text)
				.join(''),
		)
		.find((value) => value.trim())
	const images = [...kinds.entries()]
		.map(([kind, count]) =>
			t('{{count}} 张{{kind}}', {
				count,
				kind: t(kindNames[kind]),
			}),
		)
		.join(' · ')
	return {
		key: scene.id ?? String(index),
		title: scene.title,
		desc: text ?? '',
		images,
		art,
	}
}

type FirstChapter = {
	scenes: SceneCard[]
	sourceLanguage?: string
	workLanguage?: string
}

/** 第一章读取状态：loading / ready / failed 三段，失败可重试。 */
type FirstChapterState =
	| { status: 'loading' }
	| { status: 'ready'; chapter: FirstChapter }
	| { status: 'failed' }

function useFirstChapterScenes(workId: string, chapterId?: string) {
	const [state, setState] = useState<FirstChapterState>({ status: 'loading' })
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		void attempt
		if (!chapterId) return
		setState({ status: 'loading' })
		const request = window.novelive.call('production.playerChapter', {
			workId,
			chapterId,
		})
		request.promise.then(
			({ script, registry, customMarks, chapter }) => {
				const parsed = parseScript(script, {
					customMarks: Object.keys(customMarks),
				})
				const entries = new Map(
					registry.entries.map((entry) => [entry.id, entry]),
				)
				// 章节文档是开放模型；译本工程可能附带 sourceLanguage / workLanguage，
				// 后端没给时不显示语言对照。
				const extra = chapter as typeof chapter & {
					sourceLanguage?: unknown
					workLanguage?: unknown
				}
				setState({
					status: 'ready',
					chapter: {
						scenes: parsed.scenes.map((scene, index) =>
							sceneCard(scene, index, entries),
						),
						sourceLanguage:
							typeof extra.sourceLanguage === 'string'
								? extra.sourceLanguage
								: undefined,
						workLanguage:
							typeof extra.workLanguage === 'string'
								? extra.workLanguage
								: undefined,
					},
				})
			},
			() => setState({ status: 'failed' }),
		)
		return () => request.cancel()
	}, [workId, chapterId, attempt])
	return {
		state: chapterId ? state : ({ status: 'loading' } as const),
		retry: () => setAttempt((n) => n + 1),
	}
}

export function ConfirmFirstPage() {
	const { snapshot, run, busy, project } = useWorkProduction()
	const navigate = useNavigate()
	const toast = useToast()
	const { workId, phase, blockedChapterId } = snapshot
	const first = snapshot.chapters[0]
	const ready = phase === 'confirm-first' && first?.status === 'published'
	const { state, retry } = useFirstChapterScenes(
		workId,
		ready ? first.chapterId : undefined,
	)
	const firstChapter = state.status === 'ready' ? state.chapter : undefined
	const scenes = firstChapter?.scenes
	const languagePair =
		firstChapter?.sourceLanguage &&
		firstChapter?.workLanguage &&
		firstChapter.sourceLanguage !== firstChapter.workLanguage
			? `${formatLanguage(firstChapter.sourceLanguage)} → ${formatLanguage(firstChapter.workLanguage)}`
			: null

	return (
		<Page
			eyebrow={
				project
					? `${t('{{series}} · {{volume}}', {
							series: project.seriesTitle,
							volume: formatVolumeLabel({
								index: project.volumeIndex,
								title: project.volumeTitle,
							}),
						})} · ${t('确认点 2 / 2')}`
					: t('确认点 2 / 2')
			}
			title={
				<span className={local.title}>
					{snapshot.title
						? `${snapshot.title} · ${t('第一章成品')}`
						: t('第一章成品')}
					<InfoTooltip
						label={t('确认点说明')}
						text={t('确认后其余章节在后台按卷连续做，做完一章即可游玩。')}
					/>
				</span>
			}
			actions={
				ready && (
					<div className={local.actions}>
						<ButtonLink
							variant="secondary"
							icon={PlayCircle}
							to={workRoute('play', workId)}
						>
							{t('试玩第一章')}
						</ButtonLink>
						<Dropdown
							label={t('更多')}
							className={buttonClasses('ghost')}
							trigger={
								<>
									<Ellipsis aria-hidden="true" size={16} />
									{t('更多')}
								</>
							}
							items={[
								{
									label: t('进编辑器修改'),
									icon: NotebookPen,
									onSelect: () =>
										navigate(
											`${workRoute('editor', workId)}?chapterId=${encodeURIComponent(first.chapterId)}`,
										),
								},
							]}
						/>
						<Button
							variant="primary"
							icon={Check}
							disabled={busy || Boolean(blockedChapterId)}
							onClick={async () => {
								if (await run('production.continue', { workId })) {
									toast(t('第一章已确认，其余章节进入后台按卷制作'), Check)
									navigate(workRoute('production', workId))
								}
							}}
						>
							{t('继续制作')}
						</Button>
					</div>
				)
			}
		>
			<div className={local.flow}>
				{ready ? (
					<>
						<SectionLabel>
							{formatChapterLabel({
								index: 1,
								title: snapshot.chapterTitles?.[first.chapterId],
							})}
							{scenes?.length
								? t(' · {{count}} 个场景', { count: scenes.length })
								: ''}
							{languagePair ? (
								<span className={local.aside}>{languagePair}</span>
							) : null}
						</SectionLabel>
						{state.status === 'loading' ? (
							<LoadingState text={t('正在读取第一章…')} />
						) : state.status === 'failed' ? (
							<ErrorNotice
								message={t('无法读取第一章，请重试。')}
								onRetry={retry}
							/>
						) : scenes && scenes.length === 0 ? (
							<EmptyState icon={NotebookPen} text={t('这一章还没有场景。')} />
						) : (
							<div className={local.scenes}>
								{(scenes ?? []).map((scene, index) => (
									<Card
										className={local.chapter}
										key={scene.key}
										role="region"
										aria-label={scene.title}
									>
										<span className={local.art} aria-hidden="true">
											{scene.art && <img src={scene.art} alt="" />}
											<span>{t('场景 {{value}}', { value: index + 1 })}</span>
										</span>
										<div className={local.cardBody}>
											<h2 className={local.cardTitle}>{scene.title}</h2>
											{scene.desc && (
												<p className={local.sceneDesc}>{scene.desc}</p>
											)}
											{scene.images && (
												<p className={local.sceneMeta}>
													<Image aria-hidden="true" size={13} />
													{scene.images}
												</p>
											)}
										</div>
									</Card>
								))}
							</div>
						)}
					</>
				) : (
					<Card>
						<EmptyState
							icon={PlayCircle}
							text={t('目前没有待确认的第一章。')}
							actions={
								<ButtonLink
									variant="secondary"
									to={workRoute('production', workId)}
								>
									{t('查看制作')}
								</ButtonLink>
							}
						/>
					</Card>
				)}
			</div>
		</Page>
	)
}
