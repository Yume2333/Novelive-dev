import type { CommandOutput } from '@novelive/creator/contract'
import { useState } from 'react'

type Choices = Extract<
	CommandOutput<'editor.regenerateImage'>,
	{ status: 'candidates' }
>

export function SceneImages({
	workId,
	assets,
	disabled,
	run,
	onApplied,
}: {
	workId: string
	assets: CommandOutput<'editor.open'>['registry']['entries']
	disabled: boolean
	run(action: () => Promise<void>): Promise<void>
	onApplied(): void
}) {
	const [selection, setSelection] = useState('')
	const [instruction, setInstruction] = useState('')
	const [choices, setChoices] = useState<Choices>()
	const [revision, setRevision] = useState('')
	const assetId = selection || assets[0]?.id
	if (!assetId) return null
	const generate = (count: number) =>
		void run(async () => {
			setChoices(undefined)
			const { revision } = await window.novelive.call('editor.imageRevision', {
				workId,
				assetId,
			}).promise
			const result = await window.novelive.call('editor.regenerateImage', {
				workId,
				assetId,
				expectedRevision: revision,
				count,
				...(instruction.trim() ? { instruction: instruction.trim() } : {}),
			}).promise
			if (result.status === 'applied') onApplied()
			else {
				setRevision(revision)
				setChoices(result)
			}
		})
	return (
		<section aria-label="场景图片">
			<div className="editor-toolbar">
				<label>
					图片
					<select
						aria-label="图片"
						value={assetId}
						disabled={disabled}
						onChange={(event) => {
							setSelection(event.target.value)
							setChoices(undefined)
						}}
					>
						{assets.map((asset) => (
							<option key={asset.id} value={asset.id}>
								{asset.id}
							</option>
						))}
					</select>
				</label>
				<label>
					重绘要求
					<input
						aria-label="重绘要求"
						value={instruction}
						disabled={disabled}
						onChange={(event) => setInstruction(event.target.value)}
					/>
				</label>
				<button type="button" disabled={disabled} onClick={() => generate(1)}>
					出一张，直接替换
				</button>
				<button type="button" disabled={disabled} onClick={() => generate(2)}>
					多出几张再挑
				</button>
			</div>
			{choices && (
				<section
					className="editor-toolbar editor-image-candidates"
					aria-label="候选图片"
				>
					{choices.candidates.map((candidate, index) => (
						<button
							type="button"
							key={candidate.id}
							aria-label={`选择版本 ${index + 1}`}
							disabled={disabled}
							onClick={() =>
								void run(async () => {
									await window.novelive.call('editor.selectImage', {
										workId,
										assetId,
										expectedRevision: revision,
										candidateId: candidate.id,
									}).promise
									setChoices(undefined)
									onApplied()
								})
							}
						>
							<img
								src={window.novelive.resourceUrl(candidate.cachePath)}
								alt={`候选版本 ${index + 1}`}
							/>
							选择版本 {index + 1}
						</button>
					))}
				</section>
			)}
		</section>
	)
}
