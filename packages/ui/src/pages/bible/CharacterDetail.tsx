import type { CommandOutput } from '@novelive/creator/contract'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Collapse } from '../../components/Collapse'
import { scoped } from '../../i18n'
import { Fields, labelFor } from './BibleFields'
import styles from './BiblePage.module.css'

const t = scoped('bible')

type BibleCharacter = CommandOutput<'bible.get'>['characters'][number]

const handledCharacterKeys = [
	'id',
	'status',
	'occurrences',
	'conflict',
	'name',
	'originalName',
	'aliases',
	'major',
	'addresses',
	'identity',
	'personality',
	'speech',
	'appearance',
	'costumes',
	'expressions',
	'references',
	'reuse',
	'knows',
	'changes',
	'firstSeenChapter',
	'revealedChapter',
] as const

export function CharacterDetail({
	character,
	characters,
	focused,
	occurrences,
}: {
	character: BibleCharacter
	characters: readonly BibleCharacter[]
	focused?: boolean
	occurrences?: ReactNode
}) {
	const [changesOpen, setChangesOpen] = useState(false)
	const changes = character.changes ?? []
	const headChanges = changes.slice(0, 2)
	const tailChanges = changes.slice(2)

	const profileRows: { key: string; label: string; content: ReactNode }[] = []
	if (character.originalName)
		profileRows.push({
			key: 'originalName',
			label: t('原文名字'),
			content: character.originalName,
		})
	if (character.aliases.length > 0)
		profileRows.push({
			key: 'aliases',
			label: t('别名'),
			content: (
				<ul className={styles.chipList}>
					{character.aliases.map((alias) => (
						<li key={alias} className={styles.chip}>
							{alias}
						</li>
					))}
				</ul>
			),
		})
	if (character.identity)
		profileRows.push({
			key: 'identity',
			label: t('身份'),
			content: character.identity,
		})
	if (character.personality)
		profileRows.push({
			key: 'personality',
			label: t('性格'),
			content: character.personality,
		})
	if (character.speech)
		profileRows.push({
			key: 'speech',
			label: t('说话方式'),
			content: character.speech,
		})

	return (
		<article
			className={styles.card}
			id={`bible-entry-${character.id}`}
			data-focused={focused || undefined}
		>
			<header className={styles.charHead}>
				<span className={styles.avatarLg} aria-hidden="true">
					{character.name.slice(0, 1)}
				</span>
				<div className={styles.charHeadBody}>
					<div className={styles.charTitleRow}>
						<h3>{character.name}</h3>
						<span
							className={styles.chip}
							data-tone={
								character.status === 'confirmed' ? 'confirmed' : 'candidate'
							}
						>
							{character.status === 'confirmed' ? t('已确认') : t('候选')}
						</span>
						{character.major && (
							<span className={styles.chip}>{t('主要角色')}</span>
						)}
						{character.reuse && (
							<span className={styles.chip}>
								{character.reuse === 'reusable' ? t('可复用') : t('一次性')}
							</span>
						)}
					</div>
					{(character.firstSeenChapter || character.revealedChapter) && (
						<dl className={styles.inlineMeta}>
							{character.firstSeenChapter && (
								<div>
									<dt>{t('首次出场')}</dt>
									<dd>{character.firstSeenChapter}</dd>
								</div>
							)}
							{character.revealedChapter && (
								<div>
									<dt>{t('揭示章节')}</dt>
									<dd>{character.revealedChapter}</dd>
								</div>
							)}
						</dl>
					)}
				</div>
			</header>

			{character.conflict && (
				<p className={styles.conflict}>{character.conflict}</p>
			)}

			{profileRows.length > 0 && (
				<dl className={styles.fields}>
					{profileRows.map((row) => (
						<div key={row.key}>
							<dt>{row.label}</dt>
							<dd>{row.content}</dd>
						</div>
					))}
				</dl>
			)}

			{character.appearance && (
				<section className={styles.detailSection}>
					<h4 className={styles.sectionHeading}>{t('外貌')}</h4>
					<p className={styles.detailText}>
						{character.appearance.description}
					</p>
					{character.appearance.anchorFeatures &&
						character.appearance.anchorFeatures.length > 0 && (
							<div className={styles.subGroup}>
								<span className={styles.subLabel}>{t('锚点特征')}</span>
								<ul className={styles.chipList}>
									{character.appearance.anchorFeatures.map((feature) => (
										<li key={feature} className={styles.chip}>
											{feature}
										</li>
									))}
								</ul>
							</div>
						)}
					{character.appearance.keyColors && (
						<div className={styles.subGroup}>
							<span className={styles.subLabel}>{t('关键颜色')}</span>
							<dl className={styles.keyColors}>
								<div>
									<dt>{t('发色')}</dt>
									<dd>{character.appearance.keyColors.hair}</dd>
								</div>
								<div>
									<dt>{t('瞳色')}</dt>
									<dd>{character.appearance.keyColors.eyes}</dd>
								</div>
								<div>
									<dt>{t('服装')}</dt>
									<dd>{character.appearance.keyColors.clothing}</dd>
								</div>
							</dl>
						</div>
					)}
				</section>
			)}

			{character.addresses && character.addresses.length > 0 && (
				<section className={styles.detailSection}>
					<h4 className={styles.sectionHeading}>{t('称呼')}</h4>
					<ul className={styles.objectList}>
						{(() => {
							const seen = new Map<string, number>()
							return character.addresses.map((address) => {
								const speakerName =
									characters.find((item) => item.id === address.speakerId)
										?.name ?? address.speakerId
								const base = `${address.speakerId}-${address.name}`
								const count = (seen.get(base) ?? 0) + 1
								seen.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.addressRow}>
										<span>{speakerName}</span>
										<ArrowRight
											aria-hidden="true"
											size={13}
											strokeWidth={1.8}
										/>
										<strong>{address.name}</strong>
									</li>
								)
							})
						})()}
					</ul>
				</section>
			)}

			{character.costumes && character.costumes.length > 0 && (
				<section className={styles.detailSection}>
					<h4 className={styles.sectionHeading}>{t('造型')}</h4>
					<div className={styles.subGrid}>
						{character.costumes.map((costume) => (
							<div key={costume.id} className={styles.subCard}>
								<div className={styles.subCardHead}>
									<strong>{costume.id}</strong>
									{costume.fromChapter && (
										<span className={styles.chip}>
											{t('起始章')} {costume.fromChapter}
										</span>
									)}
								</div>
								<p className={styles.detailText}>{costume.description}</p>
							</div>
						))}
					</div>
				</section>
			)}

			{character.expressions && character.expressions.length > 0 && (
				<section className={styles.detailSection}>
					<h4 className={styles.sectionHeading}>{t('表情')}</h4>
					<div className={styles.exprGrid}>
						{character.expressions.map((expr) => (
							<div key={expr.id} className={styles.subCard}>
								<strong>{expr.id}</strong>
								<p className={styles.detailText}>{expr.description}</p>
							</div>
						))}
					</div>
				</section>
			)}

			{character.knows && character.knows.length > 0 && (
				<section className={styles.detailSection}>
					<h4 className={styles.sectionHeading}>{t('已知事实')}</h4>
					<ul className={styles.objectList}>
						{(() => {
							const seen = new Map<string, number>()
							return character.knows.map((item) => {
								const base = `${item.chapterId}-${item.fact}`
								const count = (seen.get(base) ?? 0) + 1
								seen.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.changeRow}>
										<span className={styles.chip}>{item.chapterId}</span>
										<span>{item.fact}</span>
									</li>
								)
							})
						})()}
					</ul>
				</section>
			)}

			{character.references && character.references.length > 0 && (
				<section className={styles.detailSection}>
					<h4 className={styles.sectionHeading}>{t('参考图')}</h4>
					<ul className={styles.objectList}>
						{(() => {
							const seen = new Map<string, number>()
							return character.references.map((ref) => {
								const base = `${ref.path}-${ref.description}`
								const count = (seen.get(base) ?? 0) + 1
								seen.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.subCard}>
										<strong>{ref.description}</strong>
										<code className={styles.refPath}>{ref.path}</code>
									</li>
								)
							})
						})()}
					</ul>
				</section>
			)}

			{changes.length > 0 && (
				<section className={styles.detailSection}>
					<h4 className={styles.sectionHeading}>{t('剧情变化')}</h4>
					<ul className={styles.objectList}>
						{(() => {
							const seen = new Map<string, number>()
							return headChanges.map((change) => {
								const base = `${change.chapterId}-${change.field}-${change.value}`
								const count = (seen.get(base) ?? 0) + 1
								seen.set(base, count)
								return (
									<li key={`${base}-${count}`} className={styles.changeRow}>
										<span className={styles.chip}>{change.chapterId}</span>
										<span className={styles.changeField}>
											{labelFor(change.field)}
										</span>
										<strong>{change.value}</strong>
									</li>
								)
							})
						})()}
					</ul>
					{tailChanges.length > 0 && (
						<>
							<Collapse open={changesOpen}>
								<ul className={styles.objectList}>
									{(() => {
										const seen = new Map<string, number>()
										return tailChanges.map((change) => {
											const base = `${change.chapterId}-${change.field}-${change.value}`
											const count = (seen.get(base) ?? 0) + 1
											seen.set(base, count)
											return (
												<li
													key={`${base}-${count}`}
													className={styles.changeRow}
												>
													<span className={styles.chip}>
														{change.chapterId}
													</span>
													<span className={styles.changeField}>
														{labelFor(change.field)}
													</span>
													<strong>{change.value}</strong>
												</li>
											)
										})
									})()}
								</ul>
							</Collapse>
							<button
								type="button"
								className={styles.collapseToggle}
								aria-expanded={changesOpen}
								onClick={() => setChangesOpen((open) => !open)}
							>
								<ChevronDown
									aria-hidden="true"
									size={14}
									strokeWidth={1.8}
									className="nl-chevron"
									data-open={changesOpen ? 'true' : 'false'}
								/>
								{changesOpen
									? t('收起')
									: t('还有 {{count}} 条变化', { count: tailChanges.length })}
							</button>
						</>
					)}
				</section>
			)}

			<Fields
				entry={character as unknown as Record<string, unknown>}
				omit={handledCharacterKeys}
			/>

			{occurrences}
		</article>
	)
}
