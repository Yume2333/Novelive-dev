import type { ProductionSnapshot } from '@novelive/creator/contract'
import {
	ArrowLeft,
	Check,
	CircleCheck,
	Ellipsis,
	Expand,
	Palette,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, buttonClasses, IconButton } from '../../components/Button'
import { Card, SectionLabel } from '../../components/Card'
import { Dropdown } from '../../components/Dropdown'
import { InfoTooltip } from '../../components/InfoTooltip'
import { Modal } from '../../components/Modal'
import { EmptyState, Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { formatVolumeLabel } from '../../format/chapter'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import { ProductionNotice } from '../production/ProductionNotice'
import { useWorkProduction } from '../work/WorkProduction'
import local from './Confirm.module.css'

const t = scoped('confirm')

type Visual = NonNullable<ProductionSnapshot['visual']>
type Candidate = Visual['mainVisuals'][number]
type CharacterEntry = Visual['characters'][number]

interface PreviewTarget {
	candidate: Candidate
	label: string
	subtitle: string
	source: string
	selected: boolean
	onPick(): void
}

function CandidateCard({
	candidate,
	index,
	name,
	label,
	checked,
	onChange,
	onPreview,
	source,
	multiple = false,
	disabled,
}: {
	candidate: Candidate
	index: number
	name: string
	label?: string
	checked: boolean
	onChange(): void
	onPreview(): void
	source: string
	multiple?: boolean
	disabled?: boolean
}) {
	const caption = label ?? t('方案 {{value}}', { value: index + 1 })
	return (
		<div className={local.thumb} data-selected={checked}>
			{/* label 包住 input 与说明文字，点击文字或图片都切换候选；zoom 与选中角标浮在图片上 */}
			<label className={local.thumbLabel}>
				<input
					type={multiple ? 'checkbox' : 'radio'}
					name={name}
					checked={checked}
					disabled={disabled}
					onChange={onChange}
				/>
				<img src={window.novelive.resourceUrl(candidate.cachePath)} alt="" />
				<span className={local.caption}>
					{caption}
					{checked && <Check size={16} aria-hidden="true" />}
				</span>
				<span className={local.source} aria-hidden="true">
					{source}
				</span>
			</label>
			<IconButton
				icon={Expand}
				label={t('放大预览 {{label}}', { label: caption })}
				size={26}
				iconSize={13}
				className={local.zoom}
				disabled={disabled}
				onClick={onPreview}
			/>
			{checked && (
				<span className={local.badge} aria-hidden="true">
					<Check size={13} strokeWidth={1.8} />
				</span>
			)}
		</div>
	)
}

export function ConfirmVisualPage() {
	const { snapshot } = useWorkProduction()
	const navigate = useNavigate()
	const visual = snapshot.phase === 'confirm-visual' ? snapshot.visual : null
	if (visual) return <VisualChoices visual={visual} />
	return (
		<Page title={t('角色设定 / 主视觉')}>
			<EmptyState
				icon={Palette}
				text={t('目前没有待确认的主视觉。')}
				actions={
					<Button
						variant="primary"
						onClick={() => navigate(workRoute('work', snapshot.workId))}
					>
						{t('返回概览')}
					</Button>
				}
			/>
		</Page>
	)
}

/** 展示名解析：名字缺失时用组内序数（角色 N / 造型 N），绝不显示内部 id。 */
function displayNames(groups: CharacterEntry[][]) {
	const characters = new Map<string, string>()
	const costumes = new Map<string, string>()
	groups.forEach((group, groupIndex) => {
		const first = group[0]
		if (!first) return
		characters.set(
			first.characterId,
			first.characterName ?? t('角色 {{value}}', { value: groupIndex + 1 }),
		)
		group.forEach((entry, entryIndex) => {
			costumes.set(
				keyOf(entry),
				entry.costumeName ?? t('造型 {{value}}', { value: entryIndex + 1 }),
			)
		})
	})
	return { characters, costumes }
}

/** 同一角色的多套造型在左侧只占一行；右边每张造型卡单独一个 fieldset */
function groupByCharacter(entries: CharacterEntry[]) {
	const order: string[] = []
	const map = new Map<string, CharacterEntry[]>()
	for (const entry of entries) {
		const group = map.get(entry.characterId)
		if (group) group.push(entry)
		else {
			map.set(entry.characterId, [entry])
			order.push(entry.characterId)
		}
	}
	return order.map((characterId) => map.get(characterId) ?? [])
}

const keyOf = ({
	characterId,
	costumeId,
}: {
	characterId: string
	costumeId: string
}) => `${characterId}/${costumeId}`

function VisualChoices({ visual }: { visual: Visual }) {
	const { snapshot, run, busy, project } = useWorkProduction()
	const navigate = useNavigate()
	const toast = useToast()
	const imported = visual.importedIllustrations
	const recommended = imported?.recommended ?? []
	const importedCandidates = imported?.candidates ?? []
	const defaults = [...new Set([...(imported?.selected ?? []), ...recommended])]
	const [mainId, setMainId] = useState(() => defaults[0] ?? '')
	const [characterIds, setCharacterIds] = useState<Record<string, string>>({})
	const [supplemental, setSupplemental] = useState(() => defaults.slice(1, 3))
	const [showAll, setShowAll] = useState(false)
	const [selectedCharacter, setSelectedCharacter] = useState('')
	const [preview, setPreview] = useState<PreviewTarget | null>(null)
	const visibleImported = importedCandidates.filter(
		({ id }) =>
			showAll ||
			imported?.fallback ||
			recommended.includes(id) ||
			imported?.selected.includes(id) ||
			id === mainId ||
			supplemental.includes(id),
	)
	const label = (id: string) => {
		const index = importedCandidates.findIndex(
			(candidate) => candidate.id === id,
		)
		return index === -1
			? undefined
			: recommended.includes(id)
				? t('推荐 · EPUB 插图 {{value}}', { value: index + 1 })
				: t('EPUB 插图 {{value}}', { value: index + 1 })
	}
	const mainVisuals = [...visual.mainVisuals, ...visibleImported]
	const supplementalVisuals = [
		...visual.supplemental,
		...visibleImported,
	].filter(({ id }) => id !== mainId)
	const main = mainVisuals.find(({ id }) => id === mainId)
	const supplementalIds = supplemental.filter((id) =>
		supplementalVisuals.some((candidate) => candidate.id === id),
	)
	const characters = visual.characters.flatMap(
		({ characterId, costumeId, candidates }) => {
			const candidateId = characterIds[`${characterId}/${costumeId}`]
			return candidates.some(({ id }) => id === candidateId)
				? [{ characterId, costumeId, candidateId }]
				: []
		},
	)
	const workId = snapshot.workId
	const groups = groupByCharacter(visual.characters)
	const names = displayNames(groups)
	const activeGroup =
		groups.find((group) => group[0]?.characterId === selectedCharacter) ??
		groups[0]
	const activeCharacterId = activeGroup?.[0]?.characterId ?? ''

	const missing = (main ? 0 : 1) + visual.characters.length - characters.length
	const ready = !busy && missing === 0

	// 来源只写真实渠道：EPUB 导入的插图来自作品包，其余由制作流水线生成。
	const isImported = (id: string) =>
		importedCandidates.some((candidate) => candidate.id === id) ||
		id === 'costume-epub'
	const sourceOf = (id: string) =>
		isImported(id) ? t('EPUB 插图') : t('生成候选')
	const modalSourceOf = (id: string) =>
		isImported(id) ? t('来源：EPUB 插图') : t('来源：生成候选')

	const pickMain = (id: string) => {
		setMainId(id)
		setSupplemental((ids) => ids.filter((item) => item !== id))
	}

	const openMainPreview = (candidate: Candidate, index: number) =>
		setPreview({
			candidate,
			label: label(candidate.id) ?? t('方案 {{value}}', { value: index + 1 }),
			subtitle: t('主视觉'),
			source: modalSourceOf(candidate.id),
			selected: candidate.id === mainId,
			onPick: () => pickMain(candidate.id),
		})

	const openCharacterPreview = (
		entry: CharacterEntry,
		candidate: Candidate,
		index: number,
	) => {
		const key = keyOf(entry)
		setPreview({
			candidate,
			label:
				candidate.id === 'costume-epub'
					? t('EPUB 参考方案')
					: t('方案 {{value}}', { value: index + 1 }),
			subtitle: t('{{character}} · {{costume}}', {
				character: names.characters.get(entry.characterId) ?? '',
				costume: names.costumes.get(key) ?? '',
			}),
			source: modalSourceOf(candidate.id),
			selected: characterIds[key] === candidate.id,
			onPick: () =>
				setCharacterIds((choices) => ({ ...choices, [key]: candidate.id })),
		})
	}

	const openSupplementalPreview = (
		candidate: Candidate,
		index: number,
		checked: boolean,
		locked: boolean,
	) =>
		setPreview({
			candidate,
			label: label(candidate.id) ?? t('方案 {{value}}', { value: index + 1 }),
			subtitle: t('补充画风参考（最多两张）'),
			source: modalSourceOf(candidate.id),
			selected: checked,
			onPick: () => {
				if (!checked && locked) return
				setSupplemental(
					checked
						? supplementalIds.filter((id) => id !== candidate.id)
						: [...supplementalIds, candidate.id],
				)
			},
		})

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
						})} · ${t('确认点 1 / 2')}`
					: t('确认点 1 / 2')
			}
			title={
				<span className={local.title}>
					{snapshot.title
						? `${snapshot.title} · ${t('角色设定 / 主视觉')}`
						: t('角色设定 / 主视觉')}
					<InfoTooltip
						label={t('确认点说明')}
						text={t('确认后开始制作第一章；第一章做完会再停一次。')}
					/>
				</span>
			}
			actions={
				<div className={local.actions}>
					{missing > 0 && (
						<span className={local.missing}>
							{t('还差 {{value}} 项未选定', { value: missing })}
						</span>
					)}
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
								label: t('先不确认，回作品页'),
								icon: ArrowLeft,
								onSelect: () => navigate(workRoute('work', workId)),
							},
						]}
					/>
					<Button
						variant="primary"
						icon={Check}
						disabled={!ready}
						type="submit"
						form="visual-choices"
					>
						{t('确认并制作第一章')}
					</Button>
				</div>
			}
		>
			<form
				id="visual-choices"
				className={local.flow}
				onSubmit={async (event) => {
					event.preventDefault()
					if (!main || characters.length !== visual.characters.length) return
					if (
						await run('production.confirmVisual', {
							workId,
							mainVisualId: main.id,
							characters,
							supplementalIds,
						})
					) {
						toast(t('角色设定和主视觉已确认，开始制作第一章'), Check)
						navigate(workRoute('production', workId))
					}
				}}
			>
				{visual.mattingUnavailable && (
					<ProductionNotice kind="warning">
						<span role="status">
							{t(
								'本地去背景不可用；无法生成透明底的角色可以使用占位图继续制作。',
							)}
						</span>
					</ProductionNotice>
				)}
				{imported?.fallback && (
					<ProductionNotice>
						<span role="status">
							{t('未能筛选 EPUB 插图，已显示全部插图，可手动选择。')}
						</span>
					</ProductionNotice>
				)}
				{!imported?.fallback &&
					importedCandidates.some(
						({ id }) =>
							!recommended.includes(id) && !imported?.selected.includes(id),
					) && (
						<Button
							variant="secondary"
							size="sm"
							aria-pressed={showAll}
							onClick={() => setShowAll(!showAll)}
						>
							{showAll ? t('收起未推荐的 EPUB 插图') : t('显示全部 EPUB 插图')}
						</Button>
					)}
				<fieldset className={local.section} disabled={busy}>
					<legend>
						<SectionLabel>{t('主视觉')}</SectionLabel>
					</legend>
					<Card className={`${local.cardBody} ${local.grid}`}>
						{mainVisuals.map((candidate, index) => (
							<CandidateCard
								key={candidate.id}
								candidate={candidate}
								index={index}
								name="main-visual"
								label={label(candidate.id)}
								checked={candidate.id === mainId}
								onChange={() => pickMain(candidate.id)}
								onPreview={() => openMainPreview(candidate, index)}
								source={sourceOf(candidate.id)}
							/>
						))}
					</Card>
				</fieldset>
				{activeGroup && (
					<section
						aria-labelledby="major-characters"
						className={local.characters}
					>
						<h2 id="major-characters">
							<SectionLabel>{t('第一卷主要角色')}</SectionLabel>
						</h2>
						<div className={local.characterLayout}>
							<div className={local.characterList}>
								{groups.map((group) => {
									const first = group[0]
									const characterId = first.characterId
									const doneCount = group.filter((entry) =>
										characters.some(
											(choice) =>
												choice.characterId === entry.characterId &&
												choice.costumeId === entry.costumeId,
										),
									).length
									const allDone = doneCount === group.length
									const summary =
										group.length === 1
											? `${names.costumes.get(keyOf(first)) ?? ''} · ${
													doneCount === 1 ? t('已选定') : t('未选定')
												}`
											: t('已选 {{done}} / {{total}} 套造型', {
													done: doneCount,
													total: group.length,
												})
									return (
										<button
											key={characterId}
											type="button"
											className={local.characterTab}
											aria-pressed={characterId === activeCharacterId}
											onClick={() => setSelectedCharacter(characterId)}
										>
											<span>
												<strong>{names.characters.get(characterId)}</strong>
												<small>{summary}</small>
											</span>
											{allDone && <CircleCheck aria-hidden="true" size={16} />}
										</button>
									)
								})}
							</div>
							<div className={local.characterDetail}>
								{activeGroup.map((entry) => {
									const key = keyOf(entry)
									const groupName = `${names.characters.get(entry.characterId) ?? ''} · ${names.costumes.get(key) ?? ''}`
									return (
										<fieldset
											key={key}
											className={`${local.outfit} ${local.portraits}`}
											aria-label={groupName}
											disabled={busy}
										>
											<legend className={local.outfitHeader}>
												<SectionLabel>
													{t('造型 · {{value}}', {
														value: names.costumes.get(key) ?? '',
													})}
												</SectionLabel>
											</legend>
											<Card className={`${local.cardBody} ${local.grid}`}>
												{entry.candidates.map((candidate, index) => (
													<CandidateCard
														key={candidate.id}
														candidate={candidate}
														index={index}
														name={key}
														label={
															candidate.id === 'costume-epub'
																? t('EPUB 参考方案')
																: undefined
														}
														checked={characterIds[key] === candidate.id}
														onChange={() =>
															setCharacterIds((choices) => ({
																...choices,
																[key]: candidate.id,
															}))
														}
														onPreview={() =>
															openCharacterPreview(entry, candidate, index)
														}
														source={sourceOf(candidate.id)}
													/>
												))}
											</Card>
										</fieldset>
									)
								})}
							</div>
						</div>
					</section>
				)}
				{supplementalVisuals.length > 0 && (
					<fieldset className={local.section} disabled={busy}>
						<legend>
							<SectionLabel>{t('补充画风参考（最多两张）')}</SectionLabel>
						</legend>
						<Card className={`${local.cardBody} ${local.grid}`}>
							{supplementalVisuals.map((candidate, index) => {
								const checked = supplementalIds.includes(candidate.id)
								const locked = !checked && supplementalIds.length >= 2
								return (
									<CandidateCard
										key={candidate.id}
										candidate={candidate}
										index={index}
										name="supplemental"
										label={label(candidate.id)}
										multiple
										checked={checked}
										disabled={locked}
										onChange={() =>
											setSupplemental(
												checked
													? supplementalIds.filter((id) => id !== candidate.id)
													: [...supplementalIds, candidate.id],
											)
										}
										onPreview={() =>
											openSupplementalPreview(candidate, index, checked, locked)
										}
										source={sourceOf(candidate.id)}
									/>
								)
							})}
						</Card>
					</fieldset>
				)}
			</form>
			<Modal
				open={preview !== null}
				title={preview?.label ?? ''}
				onClose={() => setPreview(null)}
				width={640}
				footer={
					preview ? (
						<>
							<Button variant="ghost" onClick={() => setPreview(null)}>
								{t('关闭')}
							</Button>
							<Button
								variant="primary"
								icon={Check}
								disabled={preview.selected}
								onClick={() => {
									preview.onPick()
									setPreview(null)
								}}
							>
								{preview.selected ? t('当前已选用') : t('选用这一版')}
							</Button>
						</>
					) : null
				}
			>
				{preview ? (
					<div className={local.flow}>
						<div className={local.preview}>
							<img
								src={window.novelive.resourceUrl(preview.candidate.cachePath)}
								alt={preview.label}
							/>
						</div>
						<div className={local.previewMeta}>
							<span
								className={`label-caps label-caps-zh ${local.previewSubtitle}`}
							>
								{preview.subtitle}
							</span>
							<span className={local.previewSource}>{preview.source}</span>
						</div>
					</div>
				) : null}
			</Modal>
		</Page>
	)
}
