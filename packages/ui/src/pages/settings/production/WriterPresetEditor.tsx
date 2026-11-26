import type { WriterPreset } from '@novelive/creator/contract'
import { ArrowRight, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, IconButton } from '../../../components/Button'
import { Field, TextInput } from '../../../components/Form'
import { Modal } from '../../../components/Modal'
import { OverlayScrollbar } from '../../../components/ScrollArea'
import { scoped } from '../../../i18n'
import styles from '../SettingsPage.module.css'

const t = scoped('settings')

function PresetTextArea({
	label,
	rows = 3,
	...props
}: {
	label: string
	value: string
	onChange(value: string): void
	rows?: number
}) {
	const ref = useRef<HTMLTextAreaElement>(null)
	return (
		<label className={styles.presetAreaLabel}>
			<span className="label-caps label-caps-zh">{label}</span>
			<span className={styles.presetArea}>
				<textarea
					ref={ref}
					className="nl-input nl-scroll-hidden"
					rows={rows}
					value={props.value}
					onChange={(event) => props.onChange(event.target.value)}
				/>
				<OverlayScrollbar targetRef={ref} />
			</span>
		</label>
	)
}

export function WriterPresetEditor({
	preset,
	busy,
	cancel,
	save,
}: {
	preset: WriterPreset
	busy: boolean
	cancel(): void
	save(preset: WriterPreset): Promise<void>
}) {
	const isNew = !preset.name
	const [name, setName] = useState(preset.name)
	const [style, setStyle] = useState(preset.style)
	const [constraints, setConstraints] = useState(preset.constraints)
	const [temperature, setTemperature] = useState(
		preset.temperature?.toString() ?? '',
	)
	const [topP, setTopP] = useState(preset.topP?.toString() ?? '')
	const [maxTokens, setMaxTokens] = useState(preset.maxTokens?.toString() ?? '')
	const [rows, setRows] = useState(() =>
		preset.replacements.map((replacement, id) => ({ ...replacement, id })),
	)
	const nextRow = useRef(preset.replacements.length)

	function numberValue(text: string) {
		return text.trim() === '' ? undefined : Number(text)
	}

	function submit() {
		const parsed = {
			temperature: numberValue(temperature),
			topP: numberValue(topP),
			maxTokens: numberValue(maxTokens),
		}
		void save({
			id: preset.id,
			name: name.trim(),
			style,
			constraints,
			...(parsed.temperature !== undefined && {
				temperature: parsed.temperature,
			}),
			...(parsed.topP !== undefined && { topP: parsed.topP }),
			...(parsed.maxTokens !== undefined && { maxTokens: parsed.maxTokens }),
			replacements: rows.map(({ find, replace }) => ({ find, replace })),
		})
	}

	return (
		<Modal
			open
			title={
				isNew
					? t('新建写手预设')
					: t('写手预设 · {{name}}', { name: preset.name })
			}
			onClose={cancel}
			width={560}
		>
			<form
				aria-label={t('编辑写手预设')}
				className={styles.presetForm}
				onSubmit={(event) => {
					event.preventDefault()
					submit()
				}}
			>
				<Field label={t('预设名称')}>
					<TextInput value={name} onChange={setName} required />
				</Field>
				<PresetTextArea
					label={t('文风说明')}
					value={style}
					onChange={setStyle}
				/>
				<PresetTextArea
					label={t('输出约束')}
					value={constraints}
					onChange={setConstraints}
				/>
				<div className={styles.sampling}>
					<Field label={t('温度')} hint={t('可留空')}>
						<TextInput
							type="number"
							value={temperature}
							min={0}
							max={2}
							step="any"
							onChange={setTemperature}
						/>
					</Field>
					<Field label="Top-P" hint={t('可留空')}>
						<TextInput
							type="number"
							value={topP}
							min={0}
							max={1}
							step="any"
							onChange={setTopP}
						/>
					</Field>
					<Field label={t('最大输出')} hint={t('可留空')}>
						<TextInput
							type="number"
							value={maxTokens}
							min={1}
							step={1}
							onChange={setMaxTokens}
						/>
					</Field>
				</div>
				<section aria-label={t('输出替换规则')} className={styles.replacements}>
					<span className="label-caps label-caps-zh">{t('输出替换规则')}</span>
					{rows.map((row, index) => (
						<div className={styles.replacementRow} key={row.id}>
							<TextInput
								aria-label={t('查找 {{value}}', { value: index + 1 })}
								value={row.find}
								placeholder={t('查找')}
								required
								onChange={(find) =>
									setRows(
										rows.map((entry) =>
											entry.id === row.id ? { ...entry, find } : entry,
										),
									)
								}
							/>
							<ArrowRight
								className={styles.replacementArrow}
								size={14}
								strokeWidth={1.8}
								aria-hidden="true"
							/>
							<TextInput
								aria-label={t('替换为 {{value}}', { value: index + 1 })}
								value={row.replace}
								placeholder={t('替换为')}
								onChange={(replace) =>
									setRows(
										rows.map((entry) =>
											entry.id === row.id ? { ...entry, replace } : entry,
										),
									)
								}
							/>
							<IconButton
								icon={X}
								label={t('移除替换规则 {{value}}', { value: index + 1 })}
								size={26}
								iconSize={14}
								disabled={busy}
								onClick={() =>
									setRows(rows.filter((entry) => entry.id !== row.id))
								}
							/>
						</div>
					))}
					<Button
						size="sm"
						icon={Plus}
						disabled={busy}
						className={styles.addReplacement}
						onClick={() =>
							setRows([
								...rows,
								{ id: nextRow.current++, find: '', replace: '' },
							])
						}
					>
						{t('添加替换规则')}
					</Button>
				</section>
				<div className={styles.presetFooter}>
					<Button variant="ghost" disabled={busy} onClick={cancel}>
						{t('取消')}
					</Button>
					<Button
						variant="primary"
						type="submit"
						loading={busy}
						disabled={!name.trim()}
					>
						{t('保存预设')}
					</Button>
				</div>
			</form>
		</Modal>
	)
}
