import {
	type ConfigUpdate,
	type MaskedConfig,
	roleModelDefaults,
	type WriterPreset,
	type WriterSettings,
} from '@novelive/creator/contract'
import { Check, ChevronDown, Copy, PenLine, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { Collapse } from '../../../components/Collapse'
import { ConfirmDialog } from '../../../components/Extended'
import { ErrorNotice } from '../../../components/Feedback'
import { CompactSelect } from '../../../components/Form'
import { useToast } from '../../../components/Toast'
import { msg, scoped } from '../../../i18n'
import styles from '../SettingsPage.module.css'
import { WriterPresetEditor } from './WriterPresetEditor'

const t = scoped('settings')

const roles = [
	['organizer', msg('整理')],
	['director', msg('主控')],
	['writer', msg('写手')],
	['reviewer-script', msg('审稿')],
	['artist', msg('美术导演')],
	['painter-portrait', msg('立绘画师')],
	['painter-scene', msg('场景画师')],
	['painter-variant', msg('差分画师')],
	['reviewer-visual', msg('视觉审核')],
	['illustration-screening', msg('EPUB 插图筛选')],
] as const
const slots = [
	['fast', msg('快速模型')],
	['main', msg('主模型')],
	['writing', msg('写作模型')],
	['visual', msg('视觉模型')],
] as const

export function ProductionSettings({
	config,
	update,
}: {
	config: MaskedConfig['production']
	update(patch: ConfigUpdate): Promise<MaskedConfig>
}) {
	const toast = useToast()
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const [notice, setNotice] = useState<'saved' | 'failed'>()
	const [editing, setEditing] = useState<WriterPreset>()
	const [deleting, setDeleting] = useState<WriterPreset>()
	const { writer, roleModels } = config

	async function save(production: NonNullable<ConfigUpdate['production']>) {
		setBusy(true)
		setNotice(undefined)
		try {
			await update({ production })
			setNotice('saved')
			return true
		} catch {
			setNotice('failed')
			return false
		} finally {
			setBusy(false)
		}
	}

	function saveWriter(patch: Partial<WriterSettings>) {
		return save({ writer: { ...writer, ...patch } })
	}

	return (
		<section aria-labelledby="production-settings">
			<h2 id="production-settings" className={styles.advanced}>
				<button
					className={styles.expand}
					type="button"
					aria-label={t('高级设置')}
					aria-expanded={open}
					aria-controls="production-settings-panel"
					onClick={() => setOpen((value) => !value)}
				>
					<span className="label-caps label-caps-zh">{t('高级')}</span>{' '}
					<span className="nl-chevron" data-open={open}>
						<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
					</span>
				</button>
			</h2>
			<Collapse open={open}>
				<div className={styles.cards} id="production-settings-panel">
					<section
						className={`glass-panel ${styles.card}`}
						aria-label={t('角色模型配置')}
					>
						{roles.map(([role, name]) => (
							<div className={styles.row} key={role}>
								<strong>{t(name)}</strong>
								<CompactSelect
									aria-label={t('{{name}}模型', { name: t(name) })}
									value={roleModels[role] ?? roleModelDefaults[role]}
									options={slots.map(([slot, title]) => ({
										value: slot,
										label:
											slot === roleModelDefaults[role]
												? t('{{title}}（默认）', { title: t(title) })
												: t(title),
									}))}
									disabled={busy}
									onChange={(slot) => {
										void save({ roleModels: { [role]: slot } }).then(
											(saved) => {
												if (saved) toast(t('角色模型已更新'), Check)
											},
										)
									}}
								/>
							</div>
						))}
					</section>
					<section
						className={`glass-panel ${styles.card} ${styles.presets}`}
						aria-label={t('写手预设')}
					>
						<div className={styles.presetsHead}>
							<strong>{t('写手预设')}</strong>
							<Button
								size="sm"
								icon={Plus}
								disabled={busy || Boolean(editing)}
								onClick={() =>
									setEditing({
										id: crypto.randomUUID(),
										name: '',
										style: '',
										constraints: '',
										replacements: [],
									})
								}
							>
								{t('新建预设')}
							</Button>
						</div>
						<div className={styles.presetList}>
							{writer.presets.map((preset) => {
								const isDefault = writer.defaultPresetId === preset.id
								return (
									<div
										className={`hover-row ${styles.presetRow}`}
										key={preset.id}
									>
										<strong className={styles.presetName}>{preset.name}</strong>
										{isDefault ? (
											<span className={styles.presetDefault}>
												{t('全局默认')}
											</span>
										) : null}
										<span className="row-actions">
											{!isDefault ? (
												<Button
													size="sm"
													variant="ghost"
													icon={Check}
													disabled={busy || Boolean(editing)}
													onClick={() => {
														void saveWriter({
															defaultPresetId: preset.id,
														}).then((saved) => {
															if (saved)
																toast(
																	t('已将「{{name}}」设为全局默认', {
																		name: preset.name,
																	}),
																	Check,
																)
														})
													}}
												>
													{t('设为默认')}
												</Button>
											) : null}
											<Button
												size="sm"
												variant="ghost"
												icon={PenLine}
												disabled={busy || Boolean(editing)}
												onClick={() => setEditing(preset)}
											>
												{t('编辑')}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												icon={Copy}
												disabled={busy || Boolean(editing)}
												onClick={() => {
													void saveWriter({
														presets: [
															...writer.presets,
															{
																...preset,
																id: crypto.randomUUID(),
																name: t('{{name}} 副本', {
																	name: preset.name,
																}),
															},
														],
													}).then((saved) => {
														if (saved)
															toast(
																t('已复制预设「{{name}}」', {
																	name: preset.name,
																}),
																Copy,
															)
													})
												}}
											>
												{t('复制')}
											</Button>
											{!isDefault ? (
												<Button
													size="sm"
													variant="ghost"
													icon={Trash2}
													disabled={busy || Boolean(editing)}
													onClick={() => setDeleting(preset)}
												>
													{t('删除')}
												</Button>
											) : null}
										</span>
									</div>
								)
							})}
						</div>
					</section>
					{notice === 'saved' && (
						<p role="status" className={styles.success}>
							{t('高级设置已保存')}
						</p>
					)}
					{notice === 'failed' && (
						<ErrorNotice message={t('无法保存高级设置，请检查输入后重试。')} />
					)}
				</div>
			</Collapse>
			{editing && (
				<WriterPresetEditor
					preset={editing}
					busy={busy}
					cancel={() => setEditing(undefined)}
					save={async (preset) => {
						const presets = writer.presets.some(({ id }) => id === preset.id)
							? writer.presets.map((entry) =>
									entry.id === preset.id ? preset : entry,
								)
							: [...writer.presets, preset]
						if (await saveWriter({ presets })) {
							setEditing(undefined)
							toast(t('写手预设已保存'), Check)
						}
					}}
				/>
			)}
			<ConfirmDialog
				open={deleting !== undefined}
				danger
				busy={busy}
				title={t('删除写手预设')}
				message={
					deleting
						? t('确定删除写手预设「{{name}}」吗？删除后无法恢复。', {
								name: deleting.name,
							})
						: ''
				}
				confirmLabel={t('删除')}
				onCancel={() => setDeleting(undefined)}
				onConfirm={() => {
					if (!deleting) return
					void saveWriter({
						presets: writer.presets.filter(({ id }) => id !== deleting.id),
					}).then((saved) => {
						if (saved)
							toast(t('已删除「{{name}}」', { name: deleting.name }), Trash2)
					})
					setDeleting(undefined)
				}}
			/>
		</section>
	)
}
