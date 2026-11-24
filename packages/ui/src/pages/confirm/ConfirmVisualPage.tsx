import type { ProductionSnapshot } from '@novelive/creator/contract'
import { Check, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { InfoTooltip } from '../../components/InfoTooltip'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import styles from '../production/Production.module.css'
import { ProductionNotice } from '../production/ProductionNotice'
import { useWorkProduction } from '../work/WorkProduction'
import local from './Confirm.module.css'

const t = scoped('confirm')

type Visual = NonNullable<ProductionSnapshot['visual']>
type Candidate = Visual['mainVisuals'][number]

function CandidateCard({
	candidate,
	index,
	name,
	label,
	checked,
	onChange,
	multiple = false,
	disabled,
}: {
	candidate: Candidate
	index: number
	name: string
	label?: string
	checked: boolean
	onChange(): void
	multiple?: boolean
	disabled?: boolean
}) {
	return (
		<label className={local.thumb} data-selected={checked}>
			<input
				type={multiple ? 'checkbox' : 'radio'}
				name={name}
				checked={checked}
				disabled={disabled}
				onChange={onChange}
			/>
			<img src={window.novelive.resourceUrl(candidate.cachePath)} alt="" />
			<span>
				{label ?? t('方案 {{value}}', { value: index + 1 })}
				{checked && <Check size={16} aria-hidden="true" />}
			</span>
		</label>
	)
}

export function ConfirmVisualPage() {
	const { snapshot } = useWorkProduction()
	const visual = snapshot.phase === 'confirm-visual' ? snapshot.visual : null
	if (visual) return <VisualChoices visual={visual} />
	return (
		<Page title={t('角色设定 / 主视觉')}>
			<div className={styles.flow}>
				<section className={`${styles.panel} ${styles.panelBody}`}>
					<p className={styles.muted}>{t('目前没有待确认的主视觉。')}</p>
					<Link
						className={styles.ghost}
						to={workRoute('work', snapshot.workId)}
					>
						{t('返回概览')}
					</Link>
				</section>
			</div>
		</Page>
	)
}

function VisualChoices({ visual }: { visual: Visual }) {
	const { snapshot, run, busy } = useWorkProduction()
	const navigate = useNavigate()
	const imported = visual.importedIllustrations
	const recommended = imported?.recommended ?? []
	const importedCandidates = imported?.candidates ?? []
	const defaults = [...new Set([...(imported?.selected ?? []), ...recommended])]
	const [mainId, setMainId] = useState(() => defaults[0] ?? '')
	const [characterIds, setCharacterIds] = useState<Record<string, string>>({})
	const [supplemental, setSupplemental] = useState(() => defaults.slice(1, 3))
	const [showAll, setShowAll] = useState(false)
	const [selectedKey, setSelectedKey] = useState('')
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
	const keyOf = ({
		characterId,
		costumeId,
	}: {
		characterId: string
		costumeId: string
	}) => `${characterId}/${costumeId}`
	const active =
		visual.characters.find((character) => keyOf(character) === selectedKey) ??
		visual.characters[0]
	const activeKey = active ? keyOf(active) : ''

	const missing = (main ? 0 : 1) + visual.characters.length - characters.length
	const ready = !busy && missing === 0

	return (
		<Page
			eyebrow={t('确认点 1 / 2')}
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
				<div className={styles.actions}>
					{missing > 0 && (
						<span className={local.missing}>
							{t('还差 {{value}} 项未选定', { value: missing })}
						</span>
					)}
					<Link className={styles.ghost} to={workRoute('work', workId)}>
						{t('返回概览')}
					</Link>
					<button
						className={styles.primary}
						disabled={!ready}
						form="visual-choices"
						type="submit"
					>
						<Check aria-hidden="true" size={16} />
						{t('确认并制作第一章')}
					</button>
				</div>
			}
		>
			<form
				id="visual-choices"
				className={styles.flow}
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
					)
						navigate(workRoute('production', workId))
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
						<button
							className={styles.ghost}
							type="button"
							aria-pressed={showAll}
							onClick={() => setShowAll(!showAll)}
						>
							{showAll ? t('收起未推荐的 EPUB 插图') : t('显示全部 EPUB 插图')}
						</button>
					)}
				<fieldset className={local.section} disabled={busy}>
					<legend>
						<span className={styles.sectionLabel}>{t('主视觉')}</span>
					</legend>
					<div className={`${styles.panel} ${styles.panelBody} ${local.grid}`}>
						{mainVisuals.map((candidate, index) => (
							<CandidateCard
								key={candidate.id}
								candidate={candidate}
								index={index}
								name="main-visual"
								label={label(candidate.id)}
								checked={candidate.id === mainId}
								onChange={() => {
									setMainId(candidate.id)
									setSupplemental((ids) =>
										ids.filter((id) => id !== candidate.id),
									)
								}}
							/>
						))}
					</div>
				</fieldset>
				{active && (
					<section
						aria-labelledby="major-characters"
						className={local.characters}
					>
						<h2 id="major-characters" className={styles.sectionLabel}>
							{t('第一卷主要角色')}
						</h2>
						<div className={local.characterLayout}>
							<div className={local.characterList}>
								{visual.characters.map(
									({ characterId, costumeId, characterName, costumeName }) => {
										const key = `${characterId}/${costumeId}`
										const done = characters.some(
											(choice) =>
												`${choice.characterId}/${choice.costumeId}` === key,
										)
										return (
											<button
												key={key}
												type="button"
												className={local.characterTab}
												aria-pressed={key === activeKey}
												onClick={() => setSelectedKey(key)}
											>
												<span>
													<strong>{characterName ?? characterId}</strong>
													<small>
														{costumeName ?? costumeId} ·{' '}
														{done ? t('已选定') : t('未选定')}
													</small>
												</span>
												{done && <CircleCheck aria-hidden="true" size={16} />}
											</button>
										)
									},
								)}
							</div>
							<fieldset
								key={activeKey}
								className={`${styles.panel} ${styles.panelBody} ${local.section} ${local.portraits}`}
								disabled={busy}
							>
								<legend className={local.character}>
									<h3>
										{active.characterName ?? active.characterId} ·{' '}
										{active.costumeName ?? active.costumeId}
									</h3>
								</legend>
								<div className={local.grid}>
									{active.candidates.map((candidate, index) => (
										<CandidateCard
											key={candidate.id}
											candidate={candidate}
											index={index}
											name={activeKey}
											label={
												candidate.id === 'costume-epub'
													? t('EPUB 参考方案')
													: undefined
											}
											checked={characterIds[activeKey] === candidate.id}
											onChange={() =>
												setCharacterIds((choices) => ({
													...choices,
													[activeKey]: candidate.id,
												}))
											}
										/>
									))}
								</div>
							</fieldset>
						</div>
					</section>
				)}
				{supplementalVisuals.length > 0 && (
					<fieldset className={local.section} disabled={busy}>
						<legend>
							<span className={styles.sectionLabel}>
								{t('补充画风参考（最多两张）')}
							</span>
						</legend>
						<div
							className={`${styles.panel} ${styles.panelBody} ${local.grid}`}
						>
							{supplementalVisuals.map((candidate, index) => {
								const checked = supplementalIds.includes(candidate.id)
								return (
									<CandidateCard
										key={candidate.id}
										candidate={candidate}
										index={index}
										name="supplemental"
										label={label(candidate.id)}
										multiple
										checked={checked}
										disabled={!checked && supplementalIds.length >= 2}
										onChange={() =>
											setSupplemental(
												checked
													? supplementalIds.filter((id) => id !== candidate.id)
													: [...supplementalIds, candidate.id],
											)
										}
									/>
								)
							})}
						</div>
					</fieldset>
				)}
			</form>
		</Page>
	)
}
