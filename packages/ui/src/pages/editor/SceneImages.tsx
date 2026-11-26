import type { CommandOutput } from '@novelive/creator/contract'
import {
	Image as ImageIcon,
	Images,
	RefreshCw,
	SlidersHorizontal,
	User,
} from 'lucide-react'
import { useState } from 'react'
import { Button, Spinner } from '../../components/Button'
import { Dropdown, type DropdownItem } from '../../components/Dropdown'
import { CompactSelect, Field, TextInput } from '../../components/Form'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { formatAssetLabel } from '../../format/asset'
import { scoped } from '../../i18n'

const t = scoped('editor')

type Choices = Extract<
	CommandOutput<'editor.regenerateImage'>,
	{ status: 'candidates' }
>

type AssetEntry = CommandOutput<'editor.open'>['registry']['entries'][number]

export interface SceneImagesProps {
	workId: string
	assets: readonly AssetEntry[]
	activeBackgroundId?: string
	activePortraitId?: string
	speakerNames: Readonly<Record<string, string>>
	disabled: boolean
	run(action: () => Promise<void>): Promise<void>
	onApplied(assetId: string): Promise<void>
	onRegeneratingChange?(target: 'bg' | 'portrait' | null): void
}

type ImageKind = 'bg' | 'portrait'

function isBackgroundLike(asset: AssetEntry) {
	return (
		asset.type === 'cg' ||
		asset.type === 'location' ||
		(asset.type !== 'character' && asset.type !== 'expression')
	)
}

function isPortraitLike(asset: AssetEntry) {
	return asset.type === 'character' || asset.type === 'expression'
}

const assetLabel = (
	id: string,
	speakerNames: Readonly<Record<string, string>>,
) => formatAssetLabel(id, { characters: speakerNames })

export function SceneImages({
	workId,
	assets,
	activeBackgroundId,
	activePortraitId,
	speakerNames,
	disabled,
	run,
	onApplied,
	onRegeneratingChange,
}: SceneImagesProps) {
	const toast = useToast()
	const [choices, setChoices] = useState<Choices>()
	const [choicesAssetId, setChoicesAssetId] = useState('')
	const [choicesTitle, setChoicesTitle] = useState('')
	const [revision, setRevision] = useState('')
	const [generatingTarget, setGeneratingTarget] = useState<ImageKind | null>(
		null,
	)
	const [customModal, setCustomModal] = useState<{
		kind: ImageKind
		assetId: string
	} | null>(null)
	const [customAssetId, setCustomAssetId] = useState('')
	const [instruction, setInstruction] = useState('')

	if (assets.length === 0) return null

	const bgAsset =
		assets.find((asset) => asset.id === activeBackgroundId) ??
		assets.find(isBackgroundLike)
	const portraitAsset =
		assets.find((asset) => asset.id === activePortraitId) ??
		assets.find(isPortraitLike)
	const bgLabelText = bgAsset ? assetLabel(bgAsset.id, speakerNames) : ''
	const portraitLabelText = portraitAsset
		? assetLabel(portraitAsset.id, speakerNames)
		: ''

	const generate = (
		assetId: string,
		kind: ImageKind,
		count: number,
		customInstruction: string,
	) =>
		void run(async () => {
			setGeneratingTarget(kind)
			onRegeneratingChange?.(kind)
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
					...(customInstruction.trim()
						? { instruction: customInstruction.trim() }
						: {}),
				}).promise
				if (result.status === 'applied') {
					await onApplied(assetId)
					toast(t('图片已替换'), ImageIcon)
				} else {
					setRevision(revision)
					setChoices(result)
					setChoicesAssetId(assetId)
					setChoicesTitle(
						kind === 'bg'
							? t('背景 · {{name}}', {
									name: assetLabel(assetId, speakerNames),
								})
							: t('立绘 · {{name}}', {
									name: assetLabel(assetId, speakerNames),
								}),
					)
				}
			} finally {
				setGeneratingTarget(null)
				onRegeneratingChange?.(null)
			}
		})

	const openCustomModal = (kind: ImageKind, assetId: string) => {
		setCustomModal({ kind, assetId })
		setCustomAssetId(assetId)
		setInstruction('')
	}

	const generateCustom = (count: number) => {
		if (!customModal) return
		const { kind } = customModal
		const targetId = customAssetId
		const instr = instruction
		setCustomModal(null)
		void generate(targetId, kind, count, instr)
	}

	const menuItems = (assetId: string, kind: ImageKind): DropdownItem[] => [
		{
			label: t('出一张，直接替换'),
			icon: ImageIcon,
			disabled: disabled || generatingTarget !== null,
			onSelect: () => generate(assetId, kind, 1, ''),
		},
		{
			label: t('多出几张再挑'),
			icon: Images,
			disabled: disabled || generatingTarget !== null,
			onSelect: () => generate(assetId, kind, 2, ''),
		},
		{
			label: t('带要求重绘…'),
			icon: SlidersHorizontal,
			disabled: disabled || generatingTarget !== null,
			onSelect: () => openCustomModal(kind, assetId),
		},
	]

	const renderTrigger = (kind: ImageKind) => (
		<span className="editor-stage-footer-trigger">
			{generatingTarget === kind ? (
				<Spinner size={13} />
			) : (
				<RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" />
			)}
			{t('重新生成')}
		</span>
	)

	const customOptions = customModal
		? assets
				.filter((asset) =>
					customModal.kind === 'bg'
						? isBackgroundLike(asset)
						: isPortraitLike(asset),
				)
				.map((asset) => ({
					value: asset.id,
					label:
						customModal.kind === 'bg'
							? assetLabel(asset.id, speakerNames)
							: assetLabel(asset.id, speakerNames),
				}))
		: []
	const customOptionsList =
		customOptions.length > 0
			? customOptions
			: assets.map((asset) => ({ value: asset.id, label: asset.id }))

	return (
		<section className="editor-stage-footer" aria-label={t('场景图片')}>
			{bgAsset && (
				<span className="editor-stage-footer-item">
					<ImageIcon size={15} strokeWidth={1.8} aria-hidden="true" />
					<span className="editor-stage-footer-label">
						{t('背景 · {{name}}', { name: bgLabelText })}
					</span>
					<Dropdown
						label={t('重新生成背景')}
						className="editor-stage-footer-btn"
						trigger={renderTrigger('bg')}
						items={menuItems(bgAsset.id, 'bg')}
					/>
				</span>
			)}
			{portraitAsset && (
				<span className="editor-stage-footer-item">
					<User size={15} strokeWidth={1.8} aria-hidden="true" />
					<span className="editor-stage-footer-label">
						{t('立绘 · {{name}}', { name: portraitLabelText })}
					</span>
					<Dropdown
						label={t('重新生成立绘')}
						className="editor-stage-footer-btn"
						trigger={renderTrigger('portrait')}
						items={menuItems(portraitAsset.id, 'portrait')}
					/>
				</span>
			)}

			<Modal
				open={customModal !== null}
				title={
					customModal?.kind === 'bg' ? t('重新生成背景') : t('重新生成立绘')
				}
				onClose={() => setCustomModal(null)}
				width={460}
				footer={
					<>
						<Button variant="ghost" onClick={() => setCustomModal(null)}>
							{t('取消')}
						</Button>
						<Button
							variant="secondary"
							icon={Images}
							disabled={disabled || generatingTarget !== null}
							onClick={() => generateCustom(2)}
						>
							{t('多出几张再挑')}
						</Button>
						<Button
							variant="primary"
							icon={ImageIcon}
							disabled={disabled || generatingTarget !== null}
							onClick={() => generateCustom(1)}
						>
							{t('出一张，直接替换')}
						</Button>
					</>
				}
			>
				{customOptionsList.length > 0 && (
					<Field label={t('图片')}>
						<CompactSelect
							aria-label={t('图片')}
							value={customAssetId}
							onChange={setCustomAssetId}
							options={customOptionsList}
						/>
					</Field>
				)}
				<Field label={t('重绘要求')}>
					<TextInput
						aria-label={t('重绘要求')}
						value={instruction}
						onChange={setInstruction}
						placeholder={t('例如：光线更柔和、画面更偏冷色调')}
					/>
				</Field>
			</Modal>

			<Modal
				open={!!choices}
				title={choicesTitle}
				onClose={() => setChoices(undefined)}
				width={560}
			>
				<section className="editor-candidates-grid" aria-label={t('候选图片')}>
					{choices?.candidates.map((candidate, index) => (
						<button
							type="button"
							className="editor-candidate-card"
							key={candidate.id}
							aria-label={t('选择版本 {{value}}', { value: index + 1 })}
							disabled={disabled}
							onClick={() =>
								void run(async () => {
									await window.novelive.call('editor.selectImage', {
										workId,
										assetId: choicesAssetId,
										expectedRevision: revision,
										candidateId: candidate.id,
									}).promise
									setChoices(undefined)
									await onApplied(choicesAssetId)
									toast(t('已换上选中的版本'), ImageIcon)
								})
							}
						>
							<img
								src={window.novelive.resourceUrl(candidate.cachePath)}
								alt={t('候选版本 {{value}}', { value: index + 1 })}
							/>
							<span className="editor-candidate-badge label-caps label-caps-zh">
								{t('候选 {{value}}', { value: index + 1 })}
							</span>
						</button>
					))}
				</section>
			</Modal>
		</section>
	)
}
