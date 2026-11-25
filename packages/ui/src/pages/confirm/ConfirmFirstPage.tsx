import type { AssetRegistry } from '@novelive/format/model'
import { parseScript, type Scene } from '@novelive/format/script'
import { Check, Ellipsis, Image, NotebookPen, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Dropdown } from '../../components/Dropdown'
import { InfoTooltip } from '../../components/InfoTooltip'
import { Page } from '../../components/Page'
import { msg, scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import styles from '../production/Production.module.css'
import { chapterTitle, useWorkProduction } from '../work/WorkProduction'
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

function useFirstChapterScenes(workId: string, chapterId?: string) {
	const [scenes, setScenes] = useState<SceneCard[]>()
	useEffect(() => {
		if (!chapterId) return
		const request = window.novelive.call('production.playerChapter', {
			workId,
			chapterId,
		})
		request.promise.then(
			({ script, registry, customMarks }) => {
				const parsed = parseScript(script, {
					customMarks: Object.keys(customMarks),
				})
				const entries = new Map(
					registry.entries.map((entry) => [entry.id, entry]),
				)
				setScenes(
					parsed.scenes.map((scene, index) => sceneCard(scene, index, entries)),
				)
			},
			() => setScenes([]),
		)
		return () => request.cancel()
	}, [workId, chapterId])
	return scenes
}

export function ConfirmFirstPage() {
	const { snapshot, run, busy, project } = useWorkProduction()
	const navigate = useNavigate()
	const { workId, phase, blockedChapterId } = snapshot
	const first = snapshot.chapters[0]
	const ready = phase === 'confirm-first' && first?.status === 'published'
	const scenes = useFirstChapterScenes(
		workId,
		ready ? first.chapterId : undefined,
	)

	return (
		<Page
			eyebrow={
				project
					? `${t('{{series}} · 第 {{index}} 卷', {
							series: project.seriesTitle,
							index: project.volumeIndex,
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
					<div className={styles.actions}>
						<Link className={styles.button} to={workRoute('play', workId)}>
							<Play aria-hidden="true" size={16} />
							{t('试玩第一章')}
						</Link>
						<Dropdown
							label={t('更多')}
							className={styles.ghost}
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
						<button
							className={styles.primary}
							type="button"
							disabled={busy || Boolean(blockedChapterId)}
							onClick={async () => {
								if (await run('production.continue', { workId }))
									navigate(workRoute('production', workId))
							}}
						>
							<Check aria-hidden="true" size={16} />
							{t('继续制作')}
						</button>
					</div>
				)
			}
		>
			<div className={styles.flow}>
				{ready ? (
					<>
						<p className={styles.sectionLabel}>
							{t('第 1 章 · {{value}}', {
								value: chapterTitle(snapshot, first.chapterId),
							})}
							{scenes?.length
								? t(' · {{count}} 个场景', { count: scenes.length })
								: ''}
							<span className={local.aside}>
								{t('已发布，可以试玩，准备好后再手动继续制作。')}
							</span>
						</p>
						<div className={local.scenes}>
							{(scenes ?? []).map((scene, index) => (
								<section
									className={`${styles.panel} ${local.chapter}`}
									key={scene.key}
									aria-label={scene.title}
								>
									<span className={local.art} aria-hidden="true">
										{scene.art && <img src={scene.art} alt="" />}
										<span>{t('场景 {{value}}', { value: index + 1 })}</span>
									</span>
									<div className={styles.panelBody}>
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
								</section>
							))}
						</div>
					</>
				) : (
					<section className={`${styles.panel} ${styles.panelBody}`}>
						<p className={styles.muted}>{t('目前没有待确认的第一章。')}</p>
						<Link className={styles.ghost} to={workRoute('production', workId)}>
							{t('查看制作')}
						</Link>
					</section>
				)}
			</div>
		</Page>
	)
}
