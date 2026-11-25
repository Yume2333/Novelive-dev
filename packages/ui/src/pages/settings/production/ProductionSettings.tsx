import {
	type ConfigUpdate,
	type MaskedConfig,
	roleModelDefaults,
	type WriterPreset,
	type WriterSettings,
} from '@novelive/creator/contract'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Collapse } from '../../../components/Collapse'
import { msg, scoped } from '../../../i18n'
import { Select } from '../ModelFields'
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
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const [notice, setNotice] = useState<'saved' | 'failed'>()
	const [editing, setEditing] = useState<WriterPreset>()
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
					<ChevronDown size={16} aria-hidden="true" />
				</button>
			</h2>
			<Collapse open={open}>
				<div className={styles.cards} id="production-settings-panel">
					<section className={styles.card} aria-label={t('角色模型配置')}>
						{roles.map(([role, name]) => (
							<div className={styles.row} key={role}>
								<strong>{t(name)}</strong>
								<Select
									label={t('{{name}}模型', { name: t(name) })}
									value={roleModels[role] ?? roleModelDefaults[role]}
									options={slots.map(([slot, title]) => [
										slot,
										slot === roleModelDefaults[role]
											? t('{{title}}（默认）', { title: t(title) })
											: t(title),
									])}
									disabled={busy}
									onChange={(slot) =>
										void save({ roleModels: { [role]: slot } })
									}
								/>
							</div>
						))}
					</section>
					<section className={styles.card} aria-label={t('写手预设')}>
						<div className={styles.row}>
							<strong>{t('写手预设')}</strong>
							<button
								type="button"
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
							</button>
						</div>
						{writer.presets.map((preset) => (
							<div className={styles.row} key={preset.id}>
								<strong>{preset.name}</strong>
								{writer.defaultPresetId === preset.id ? (
									<span className={styles.muted}>{t('全局默认')}</span>
								) : (
									<button
										type="button"
										disabled={busy || Boolean(editing)}
										onClick={() =>
											void saveWriter({ defaultPresetId: preset.id })
										}
									>
										{t('设为默认')}
									</button>
								)}
								<button
									type="button"
									disabled={busy || Boolean(editing)}
									onClick={() => setEditing(preset)}
								>
									{t('编辑')}
								</button>
							</div>
						))}
						{editing && (
							<WriterPresetEditor
								preset={editing}
								busy={busy}
								cancel={() => setEditing(undefined)}
								save={async (preset) => {
									const presets = writer.presets.some(
										({ id }) => id === preset.id,
									)
										? writer.presets.map((entry) =>
												entry.id === preset.id ? preset : entry,
											)
										: [...writer.presets, preset]
									if (await saveWriter({ presets })) setEditing(undefined)
								}}
							/>
						)}
					</section>
					{notice === 'saved' && (
						<p role="status" className={styles.success}>
							{t('高级设置已保存')}
						</p>
					)}
					{notice === 'failed' && (
						<p role="alert" className={styles.error}>
							{t('无法保存高级设置，请检查输入后重试。')}
						</p>
					)}
				</div>
			</Collapse>
		</section>
	)
}
