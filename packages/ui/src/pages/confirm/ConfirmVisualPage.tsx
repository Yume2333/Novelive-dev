import type { ProductionSnapshot } from '@novelive/creator/contract'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import styles from '../production/Production.module.css'
import { ProductionNotice } from '../production/ProductionNotice'
import { useWorkProduction } from '../work/WorkProduction'

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
		<label className={styles.candidate} data-selected={checked}>
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
	return (
		<Page title={t('确认角色与主视觉')}>
			{visual ? (
				<VisualChoices visual={visual} />
			) : (
				<div className={styles.stack}>
					<p>{t('目前没有待确认的主视觉。')}</p>
					<Link to={workRoute('work', snapshot.workId)}>{t('返回概览')}</Link>
				</div>
			)}
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

	return (
		<form
			className={styles.stack}
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
			<p className={styles.lead}>
				{t('确认点 1 / 2 · 选择首卷主要角色的设定和全作统一的主视觉。')}
			</p>
			{visual.mattingUnavailable && (
				<ProductionNotice>
					<span role="status">
						{t(
							'本地去背景不可用；无法生成透明底的角色可以使用占位图继续制作。',
						)}
					</span>
				</ProductionNotice>
			)}
			{imported?.fallback ? (
				<p className={styles.notice} role="status">
					{t('未能筛选 EPUB 插图，已显示全部插图，可手动选择。')}
				</p>
			) : importedCandidates.some(
					({ id }) =>
						!recommended.includes(id) && !imported?.selected.includes(id),
				) ? (
				<div className={styles.actions}>
					<button
						className={styles.button}
						type="button"
						aria-pressed={showAll}
						onClick={() => setShowAll(!showAll)}
					>
						{showAll ? t('收起未推荐的 EPUB 插图') : t('显示全部 EPUB 插图')}
					</button>
				</div>
			) : null}
			<fieldset className={styles.card} disabled={busy}>
				<legend>{t('主视觉')}</legend>
				<div className={styles.gallery}>
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
			{visual.characters.length > 0 && (
				<section aria-labelledby="major-characters" className={styles.stack}>
					<h2 id="major-characters">{t('第一卷主要角色')}</h2>
					{visual.characters.map(
						({
							characterId,
							costumeId,
							characterName,
							costumeName,
							candidates,
						}) => {
							const key = `${characterId}/${costumeId}`
							return (
								<fieldset
									key={key}
									className={`${styles.card} ${styles.portraits}`}
									disabled={busy}
								>
									<legend>
										{characterName ?? characterId} · {costumeName ?? costumeId}
									</legend>
									<div className={styles.gallery}>
										{candidates.map((candidate, index) => (
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
											/>
										))}
									</div>
								</fieldset>
							)
						},
					)}
				</section>
			)}
			{supplementalVisuals.length > 0 && (
				<fieldset className={styles.card} disabled={busy}>
					<legend>{t('补充画风参考（最多两张）')}</legend>
					<div className={styles.gallery}>
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
			<div className={styles.actions}>
				<Link className={styles.button} to={workRoute('work', workId)}>
					{t('返回概览')}
				</Link>
				<button
					className={styles.primary}
					disabled={
						busy || !main || characters.length !== visual.characters.length
					}
					type="submit"
				>
					{t('确认并制作第一章')}
				</button>
			</div>
		</form>
	)
}
