import type { ProductionSnapshot } from '@novelive/creator/contract'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Page } from '../../components/Page'
import { scoped } from '../../i18n'
import { workRoute } from '../../routes/production'
import styles from '../production/Production.module.css'
import { useWorkProduction } from '../work/WorkProduction'

const t = scoped('confirm')

type Visual = NonNullable<ProductionSnapshot['visual']>
type Candidate = Visual['mainVisuals'][number]

function CandidateCard({
	candidate,
	index,
	name,
	checked,
	onChange,
	multiple = false,
	disabled,
}: {
	candidate: Candidate
	index: number
	name: string
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
				{t('方案 {{value}}', { value: index + 1 })}
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
	const [mainId, setMainId] = useState('')
	const [characterIds, setCharacterIds] = useState<Record<string, string>>({})
	const [supplemental, setSupplemental] = useState<string[]>([])
	const main = visual.mainVisuals.find(({ id }) => id === mainId)
	const supplementalIds = supplemental.filter((id) =>
		visual.supplemental.some((candidate) => candidate.id === id),
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
			<fieldset className={styles.card} disabled={busy}>
				<legend>{t('主视觉')}</legend>
				<div className={styles.gallery}>
					{visual.mainVisuals.map((candidate, index) => (
						<CandidateCard
							key={candidate.id}
							candidate={candidate}
							index={index}
							name="main-visual"
							checked={candidate.id === mainId}
							onChange={() => setMainId(candidate.id)}
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
			{visual.supplemental.length > 0 && (
				<fieldset className={styles.card} disabled={busy}>
					<legend>{t('补充画风参考（最多两张）')}</legend>
					<div className={styles.gallery}>
						{visual.supplemental.map((candidate, index) => {
							const checked = supplementalIds.includes(candidate.id)
							return (
								<CandidateCard
									key={candidate.id}
									candidate={candidate}
									index={index}
									name="supplemental"
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
