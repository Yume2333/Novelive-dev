import type { CommandOutput } from '@novelive/creator/contract'
import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { scoped } from '../../i18n'

const t = scoped('editor')

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
	onApplied(assetId: string): Promise<void>
}) {
	const [selection, setSelection] = useState('')
	const [instruction, setInstruction] = useState('')
	const [choices, setChoices] = useState<Choices>()
	const [revision, setRevision] = useState('')
	const [generating, setGenerating] = useState(false)
	const [generationStatus, setGenerationStatus] = useState('')
	const assetId = selection || assets[0]?.id
	if (!assetId) return null
	const generate = (count: number) =>
		void run(async () => {
			setGenerating(true)
			setGenerationStatus(t('正在生成图片'))
			try {
				setChoices(undefined)
				const { revision } = await window.novelive.call(
					'editor.imageRevision',
					{
						workId,
						assetId,
					},
				).promise
				const result = await window.novelive.call('editor.regenerateImage', {
					workId,
					assetId,
					expectedRevision: revision,
					count,
					...(instruction.trim() ? { instruction: instruction.trim() } : {}),
				}).promise
				if (result.status === 'applied') {
					await onApplied(assetId)
					setGenerationStatus(t('图片已替换'))
				} else {
					setRevision(revision)
					setChoices(result)
					setGenerationStatus(t('候选图片已生成'))
				}
			} catch (error) {
				setGenerationStatus(t('图片生成失败'))
				throw error
			} finally {
				setGenerating(false)
			}
		})
	return (
		<section aria-label={t('场景图片')}>
			{generationStatus && (
				<div
					className="editor-image-loading"
					role="status"
					aria-label={generationStatus}
				>
					{generating && (
						<LoaderCircle aria-hidden="true" size={18} strokeWidth={1.8} />
					)}
					{generationStatus}
				</div>
			)}
			<div className="editor-toolbar">
				<label>
					{t('图片')}
					<select
						aria-label={t('图片')}
						value={assetId}
						disabled={disabled}
						onChange={(event) => {
							setSelection(event.target.value)
							setChoices(undefined)
							setGenerationStatus('')
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
					{t('重绘要求')}
					<input
						aria-label={t('重绘要求')}
						value={instruction}
						disabled={disabled}
						onChange={(event) => setInstruction(event.target.value)}
					/>
				</label>
				<button type="button" disabled={disabled} onClick={() => generate(1)}>
					{t('出一张，直接替换')}
				</button>
				<button type="button" disabled={disabled} onClick={() => generate(2)}>
					{t('多出几张再挑')}
				</button>
			</div>
			{choices && (
				<section
					className="editor-toolbar editor-image-candidates"
					aria-label={t('候选图片')}
				>
					{choices.candidates.map((candidate, index) => (
						<button
							type="button"
							key={candidate.id}
							aria-label={t('选择版本 {{value}}', { value: index + 1 })}
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
									setGenerationStatus('')
									await onApplied(assetId)
								})
							}
						>
							<img
								src={window.novelive.resourceUrl(candidate.cachePath)}
								alt={t('候选版本 {{value}}', { value: index + 1 })}
							/>
							{t('选择版本 {{value}}', { value: index + 1 })}
						</button>
					))}
				</section>
			)}
		</section>
	)
}
