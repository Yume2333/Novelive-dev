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
import { Select } from '../ModelFields'
import styles from '../SettingsPage.module.css'
import { WriterPresetEditor } from './WriterPresetEditor'

const roles = [
	['organizer', '整理'],
	['director', '主控'],
	['writer', '写手'],
	['reviewer-script', '审稿'],
	['artist', '美术导演'],
	['painter-portrait', '立绘画师'],
	['painter-scene', '场景画师'],
	['painter-variant', '差分画师'],
	['reviewer-visual', '视觉审核'],
] as const
const slots = [
	['fast', '快速模型'],
	['main', '主模型'],
	['writing', '写作模型'],
	['visual', '视觉模型'],
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
			<h2 id="production-settings">
				<button
					className={styles.expand}
					type="button"
					aria-expanded={open}
					aria-controls="production-settings-panel"
					onClick={() => setOpen((value) => !value)}
				>
					高级设置 <ChevronDown size={16} aria-hidden="true" />
				</button>
			</h2>
			<Collapse open={open}>
				<div className={styles.cards} id="production-settings-panel">
					<section className={styles.card} aria-label="角色模型配置">
						{roles.map(([role, name]) => (
							<div className={styles.row} key={role}>
								<strong>{name}</strong>
								<Select
									label={`${name}模型`}
									value={roleModels[role] ?? roleModelDefaults[role]}
									options={slots.map(([slot, title]) => [
										slot,
										slot === roleModelDefaults[role]
											? `${title}（默认）`
											: title,
									])}
									disabled={busy}
									onChange={(slot) =>
										void save({ roleModels: { [role]: slot } })
									}
								/>
							</div>
						))}
					</section>
					<section className={styles.card} aria-label="写手预设">
						<div className={styles.row}>
							<strong>写手预设</strong>
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
								新建预设
							</button>
						</div>
						{writer.presets.map((preset) => (
							<div className={styles.row} key={preset.id}>
								<strong>{preset.name}</strong>
								{writer.defaultPresetId === preset.id ? (
									<span className={styles.muted}>全局默认</span>
								) : (
									<button
										type="button"
										disabled={busy || Boolean(editing)}
										onClick={() =>
											void saveWriter({ defaultPresetId: preset.id })
										}
									>
										设为默认
									</button>
								)}
								<button
									type="button"
									disabled={busy || Boolean(editing)}
									onClick={() => setEditing(preset)}
								>
									编辑
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
							高级设置已保存
						</p>
					)}
					{notice === 'failed' && (
						<p role="alert" className={styles.error}>
							无法保存高级设置，请检查输入后重试。
						</p>
					)}
				</div>
			</Collapse>
		</section>
	)
}
