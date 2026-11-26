import type { CommandOutput } from '@novelive/creator/contract'
import type { WorkSettings } from '@novelive/format/model'
import { effectiveMarkCss } from '@novelive/player'
import { Check, CircleAlert, ListPlus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/Button'
import { Chip } from '../../components/Card'
import { Drawer } from '../../components/Extended'
import { Details, ErrorNotice, LoadingState } from '../../components/Feedback'
import { TextInput } from '../../components/Form'
import { EmptyState } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { msg, scoped } from '../../i18n'
import local from './WorkPage.module.css'
import { useWorkProduction } from './WorkProduction'

const t = scoped('work')

type Snapshot = CommandOutput<'editor.snapshot'>

const adaptationLabel = {
	faithful: msg('忠实原文'),
	balanced: msg('平衡'),
	condensed: msg('精简'),
} as const

const densityLabel = {
	loose: msg('宽松'),
	standard: msg('标准'),
	aggressive: msg('密集'),
} as const

const resolutionLabel = {
	'2K': msg('2K（默认）'),
	'4K': msg('4K'),
} as const

function yesNo(value: boolean) {
	return value ? t('已开启') : t('已关闭')
}

function SettingRow({
	label,
	children,
}: {
	label: string
	children: React.ReactNode
}) {
	return (
		<div className={local.settingRow}>
			<span>{label}</span>
			{children}
		</div>
	)
}

function MarkEntry({
	name,
	mark,
}: {
	name: string
	mark: { css: string; perChar?: boolean }
}) {
	const sampleRef = useRef<HTMLSpanElement>(null)
	const sampleCss = effectiveMarkCss(name, mark.css)
	useEffect(() => {
		if (sampleRef.current) sampleRef.current.style.cssText = sampleCss
	}, [sampleCss])
	return (
		<div className={local.mark}>
			<div className={local.markHead}>
				<span className={local.markName}>{name}</span>
				{mark.perChar ? <Chip>{t('逐字')}</Chip> : null}
			</div>
			{mark.css ? (
				<>
					<p className={local.markSample}>
						{sampleCss ? (
							<span ref={sampleRef}>{t('示例文字')}</span>
						) : (
							<span className={local.settingValue}>{t('无可渲染样式')}</span>
						)}
					</p>
					<Details>
						<pre className={local.markCssDetail}>{mark.css}</pre>
					</Details>
				</>
			) : null}
		</div>
	)
}

function SettingsPanels({
	settings,
	presetName,
}: {
	settings: WorkSettings
	presetName?: string
}) {
	const marks = Object.entries(settings.customMarks)
	return (
		<>
			<div className={`glass-panel ${local.settingsPanel}`}>
				<span className={`label-caps label-caps-zh ${local.settingsGroup}`}>
					{t('改编')}
				</span>
				<SettingRow label={t('改编强度')}>
					<span className={local.settingChips}>
						<Chip>{`${t('改编强度')} · ${t(adaptationLabel[settings.adaptation])}`}</Chip>
						<Chip>{`${t('演出密度')} · ${t(densityLabel[settings.stagingDensity])}`}</Chip>
					</span>
				</SettingRow>
				{settings.requirements ? (
					<div>
						<SettingRow label={t('改编要求')}>
							<span />
						</SettingRow>
						<p className={local.requirements}>{settings.requirements}</p>
					</div>
				) : (
					<SettingRow label={t('改编要求')}>
						<span className={local.settingValue}>{t('无')}</span>
					</SettingRow>
				)}
				<SettingRow label={t('写手预设')}>
					<span className={local.settingValue}>
						{presetName ?? t('默认预设')}
					</span>
				</SettingRow>
				<SettingRow label={t('忠实度检查')}>
					<span className={local.settingValue}>
						{yesNo(settings.fidelityReview)}
					</span>
				</SettingRow>
				<SettingRow label={t('文风审稿')}>
					<span className={local.settingValue}>
						{yesNo(settings.styleReview)}
					</span>
				</SettingRow>
			</div>
			<div className={`glass-panel ${local.settingsPanel}`}>
				<span className={`label-caps label-caps-zh ${local.settingsGroup}`}>
					{t('出图')}
				</span>
				<SettingRow label={t('已有参考图时也停在角色设定')}>
					<span className={local.settingValue}>
						{yesNo(settings.confirmWithReferences)}
					</span>
				</SettingRow>
				<SettingRow label={t('输出分辨率')}>
					<span className={local.settingValue}>
						{t(resolutionLabel[settings.outputResolution])}
					</span>
				</SettingRow>
			</div>
			<div className={`glass-panel ${local.settingsPanel}`}>
				<span className={`label-caps label-caps-zh ${local.settingsGroup}`}>
					{t('播放器')}
				</span>
				<SettingRow label={t('作品主色')}>
					{settings.accent ? (
						<span className={local.settingChips}>
							<span
								className={local.accentSwatch}
								style={{ background: settings.accent }}
							/>
							<span className={local.settingValue}>{settings.accent}</span>
						</span>
					) : (
						<span className={local.settingValue}>{t('未设置')}</span>
					)}
				</SettingRow>
				<div>
					<SettingRow label={t('自定义标记')}>
						<span className={local.settingValue}>
							{marks.length
								? t('{{count}} 个', { count: marks.length })
								: t('无')}
						</span>
					</SettingRow>
					{marks.map(([name, mark]) => (
						<MarkEntry key={name} name={name} mark={mark} />
					))}
				</div>
			</div>
		</>
	)
}

function RulesPanel({ workId, loaded }: { workId: string; loaded: Snapshot }) {
	const toast = useToast()
	const [rules, setRules] = useState<string[]>(() => [...loaded.settings.rules])
	const [draft, setDraft] = useState('')
	const [saving, setSaving] = useState(false)
	const [savedVisible, setSavedVisible] = useState(false)
	const revision = useRef(loaded.settingsRevision)
	const saved = useRef<string[]>([...loaded.settings.rules])
	const saveTimer = useRef<number | null>(null)
	const queue = useRef<Promise<void>>(Promise.resolve())

	useEffect(() => {
		setRules([...loaded.settings.rules])
		saved.current = [...loaded.settings.rules]
		revision.current = loaded.settingsRevision
	}, [loaded])

	useEffect(
		() => () => {
			if (saveTimer.current) window.clearTimeout(saveTimer.current)
		},
		[],
	)

	const markSaved = () => {
		setSavedVisible(true)
		if (saveTimer.current) window.clearTimeout(saveTimer.current)
		saveTimer.current = window.setTimeout(() => setSavedVisible(false), 1800)
	}

	const persist = (next: string[]) => {
		const previous = [...saved.current]
		setRules(next)
		saved.current = next
		queue.current = queue.current.then(async () => {
			setSaving(true)
			try {
				const result = await window.novelive.call('editor.saveRules', {
					workId,
					expectedRevision: revision.current,
					target: { scope: 'work' },
					previous,
					next,
				}).promise
				revision.current = result.revision
				saved.current = [...result.rules]
				setRules((current) =>
					JSON.stringify(current) === JSON.stringify(next)
						? [...result.rules]
						: current,
				)
				markSaved()
			} catch {
				setRules(previous)
				saved.current = previous
				toast(t('规则保存失败，请重试。'), CircleAlert)
			} finally {
				setSaving(false)
			}
		})
	}

	const add = () => {
		const text = draft.trim()
		if (!text) return
		setDraft('')
		persist([...rules, text])
	}

	return (
		<div className={`glass-panel ${local.settingsPanel}`}>
			<div className={local.savedRow}>
				<span className={`label-caps label-caps-zh ${local.settingsGroup}`}>
					{t('本作品规则')}
				</span>
				<span
					className={local.savedBadge}
					data-visible={savedVisible || saving}
				>
					<Check size={12} strokeWidth={1.8} aria-hidden="true" />
					{saving ? t('正在保存…') : t('已自动保存')}
				</span>
			</div>
			<div>
				{rules.map((rule, index) => (
					<div
						// Rules are prose entries; duplicates keep their own position.
						// biome-ignore lint/suspicious/noArrayIndexKey: positional list edited as a whole
						key={index}
						className={`hover-row ${local.rule}`}
					>
						<span>{rule}</span>
						<span className={`row-actions ${local.rowActions}`}>
							<IconButton
								icon={X}
								label={t('删除规则')}
								size={26}
								iconSize={13}
								onClick={() => persist(rules.filter((_, i) => i !== index))}
							/>
						</span>
					</div>
				))}
				{rules.length === 0 && (
					<EmptyState icon={ListPlus} text={t('暂无规则')} />
				)}
				<div className={local.ruleForm}>
					<TextInput
						value={draft}
						onChange={setDraft}
						placeholder={t('加一条规则')}
						aria-label={t('加一条规则')}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && event.target === event.currentTarget)
								add()
						}}
					/>
					<IconButton
						icon={Plus}
						label={t('添加规则')}
						onClick={add}
						disabled={!draft.trim()}
					/>
				</div>
			</div>
		</div>
	)
}

/** 作品设置抽屉：展示真实 workSettings（editor.snapshot），本作品规则可编辑（editor.saveRules）。 */
export function WorkSettingsDrawer({
	open,
	onClose,
}: {
	open: boolean
	onClose(): void
}) {
	const { snapshot } = useWorkProduction()
	const { workId, chapters } = snapshot
	const chapterId = chapters[0]?.chapterId
	const [loaded, setLoaded] = useState<Snapshot>()
	const [error, setError] = useState('')
	const [presetName, setPresetName] = useState<string>()
	const [reload, setReload] = useState(0)

	useEffect(() => {
		void reload
		if (!open || !chapterId) return
		let active = true
		setLoaded(undefined)
		setError('')
		const request = window.novelive.call('editor.snapshot', {
			workId,
			chapterId,
		})
		request.promise.then(
			(result) => {
				if (active) setLoaded(result)
			},
			() => {
				if (active) setError(t('无法读取作品设置，请重试。'))
			},
		)
		return () => {
			active = false
			request.cancel()
		}
	}, [open, workId, chapterId, reload])

	useEffect(() => {
		if (!open || !loaded) return
		let active = true
		const presetId = loaded.settings.writerPresetId
		void window.novelive.call('config.get', {}).promise.then(
			(config) => {
				if (!active || 'configError' in config) return
				const writer = config.production.writer
				const id = presetId ?? writer.defaultPresetId
				const name = writer.presets.find((preset) => preset.id === id)?.name
				if (name) setPresetName(name)
			},
			() => {},
		)
		return () => {
			active = false
		}
	}, [open, loaded])

	return (
		<Drawer open={open} title={t('作品设置')} onClose={onClose} width={520}>
			{!chapterId ? (
				<EmptyState icon={ListPlus} text={t('暂无章节，无法读取作品设置。')} />
			) : error ? (
				<ErrorNotice
					message={error}
					onRetry={() => setReload((n) => n + 1)}
					retryLabel={t('重新读取')}
				/>
			) : !loaded ? (
				<LoadingState text={t('正在读取作品设置…')} />
			) : (
				<>
					<SettingsPanels settings={loaded.settings} presetName={presetName} />
					<RulesPanel workId={workId} loaded={loaded} />
				</>
			)}
		</Drawer>
	)
}
