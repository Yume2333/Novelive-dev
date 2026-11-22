import type { WriterPreset } from '@novelive/creator/contract'
import { useRef, useState } from 'react'
import { OverlayScrollbar } from '../../../components/ScrollArea'
import styles from '../SettingsPage.module.css'

function TextArea({
	name,
	label,
	value,
}: {
	name: string
	label: string
	value: string
}) {
	const ref = useRef<HTMLTextAreaElement>(null)
	return (
		<label className={styles.field}>
			{label}
			<span className={styles.textArea}>
				<textarea name={name} defaultValue={value} rows={3} ref={ref} />
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
	const nextRow = useRef(preset.replacements.length)
	const [rows, setRows] = useState(() =>
		preset.replacements.map((replacement, id) => ({ ...replacement, id })),
	)
	return (
		<form
			aria-label="编辑写手预设"
			className={styles.presetEditor}
			onSubmit={(event) => {
				event.preventDefault()
				const form = new FormData(event.currentTarget)
				const value = (name: string) => String(form.get(name) ?? '')
				const number = (name: string) =>
					value(name) === '' ? undefined : Number(value(name))
				const temperature = number('temperature')
				const topP = number('topP')
				const maxTokens = number('maxTokens')
				void save({
					id: preset.id,
					name: value('name').trim(),
					style: value('style'),
					constraints: value('constraints'),
					...(temperature !== undefined && { temperature }),
					...(topP !== undefined && { topP }),
					...(maxTokens !== undefined && { maxTokens }),
					replacements: rows.map(({ id }) => ({
						find: value(`find-${id}`),
						replace: value(`replace-${id}`),
					})),
				})
			}}
		>
			<label className={styles.field}>
				预设名称
				<input name="name" defaultValue={preset.name} required />
			</label>
			<TextArea name="style" label="文风说明" value={preset.style} />
			<TextArea
				name="constraints"
				label="输出约束"
				value={preset.constraints}
			/>
			<div className={styles.results}>
				<label className={styles.field}>
					温度
					<input
						type="number"
						name="temperature"
						min={0}
						max={2}
						step="any"
						defaultValue={preset.temperature}
					/>
				</label>
				<label className={styles.field}>
					Top-P
					<input
						type="number"
						name="topP"
						min={0}
						max={1}
						step="any"
						defaultValue={preset.topP}
					/>
				</label>
				<label className={styles.field}>
					最大输出
					<input
						type="number"
						name="maxTokens"
						min={1}
						step={1}
						defaultValue={preset.maxTokens}
					/>
				</label>
			</div>
			<section aria-label="输出替换规则">
				{rows.map(({ id, find, replace }, index) => (
					<div className={styles.replacement} key={id}>
						<input
							name={`find-${id}`}
							aria-label={`查找 ${index + 1}`}
							defaultValue={find}
							placeholder="查找"
							required
						/>
						<input
							name={`replace-${id}`}
							aria-label={`替换为 ${index + 1}`}
							defaultValue={replace}
							placeholder="替换为"
						/>
						<button
							type="button"
							aria-label={`移除替换规则 ${index + 1}`}
							disabled={busy}
							onClick={() => setRows(rows.filter((row) => row.id !== id))}
						>
							移除
						</button>
					</div>
				))}
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						setRows([...rows, { id: nextRow.current++, find: '', replace: '' }])
					}
				>
					添加替换规则
				</button>
			</section>
			<div className={styles.actions}>
				<button type="button" disabled={busy} onClick={cancel}>
					取消
				</button>
				<button type="submit" disabled={busy}>
					保存预设
				</button>
			</div>
		</form>
	)
}
