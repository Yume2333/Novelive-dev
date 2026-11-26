import type { CommandOutput } from '@novelive/creator/contract'
import type { WorkSettings } from '@novelive/format/model'
import { BookmarkCheck, History, Trash2, Undo2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button, IconButton } from '../../components/Button'
import { Chip, SectionLabel } from '../../components/Card'
import { Banner, Drawer, RadioGroup } from '../../components/Extended'
import { Field, Textarea } from '../../components/Form'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { formatAssetLabel } from '../../format/asset'
import { i18n, msg, scoped } from '../../i18n'
import {
	type AssetLabelInfo,
	expressionLabel,
	type SpeakerNames,
	speakerDisplayName,
} from './display'
import { RichText } from './RichText'
import { parseSentenceLines } from './sentence-lines'

const t = scoped('editor')

type HistoryEntry = CommandOutput<'editor.history'>['entries'][number]

const originLabel: Record<string, string> = {
	creator: msg('创建者'),
	agent: msg('Agent'),
	undo: msg('撤销'),
}
const kindLabel: Record<string, string> = {
	text: msg('文本'),
	expression: msg('表情'),
	'resolve-mark': msg('标记'),
	rules: msg('规则'),
	rewrite: msg('重写'),
	image: msg('图片'),
}

function formatHistoryTime(at: string): string {
	const date = new Date(at)
	if (Number.isNaN(date.getTime())) return at
	return date.toLocaleString(i18n.language, {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	})
}

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') return value
	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}

/** `rules` 条目的 JSON 数组 → 逐条规则文本；解析不了返回空数组（该行不渲染）。 */
function ruleTexts(value: unknown): string[] {
	const parsed = parseJson(value)
	if (!Array.isArray(parsed)) return []
	return parsed.filter((item): item is string => typeof item === 'string')
}

/** `resolve-mark` 条目的 JSON → 标记名；解析不了返回空串。 */
function markName(value: unknown): string {
	const parsed = parseJson(value)
	if (
		parsed &&
		typeof parsed === 'object' &&
		'name' in parsed &&
		typeof parsed.name === 'string'
	)
		return parsed.name
	return ''
}

interface DisplayContext {
	speakerNames: SpeakerNames
	customMarks: WorkSettings['customMarks']
	assetInfo: AssetLabelInfo
}

function sentenceValue(raw: string, context: DisplayContext): ReactNode {
	const sentence = parseSentenceLines(raw)[0]
	if (!sentence) return null
	const speaker = sentence.displayAs?.trim()
		? sentence.displayAs.trim()
		: sentence.speaker
			? speakerDisplayName(context.speakerNames, sentence.speaker)
			: ''
	const text = (
		<RichText
			src={sentence.text}
			base="list"
			customMarks={context.customMarks}
		/>
	)
	if (!speaker) return text
	return (
		<>
			{t('{{speaker}}：', { speaker })}
			{text}
		</>
	)
}

/**
 * 历史条目的前/后值渲染。任何一种内容都保证不输出原始 NVS 行、
 * 素材键或 JSON；无法解释的值一律舍弃（返回 null）。
 */
function historyValue(
	entry: HistoryEntry,
	field: 'previous' | 'next',
	context: DisplayContext,
): ReactNode {
	const value = entry[field]
	if (value === null || value === undefined) return null
	if (entry.kind === 'text') {
		if (typeof value !== 'string') return null
		return sentenceValue(value, context)
	}
	if (entry.kind === 'expression') {
		if (typeof value !== 'string') return null
		return expressionLabel(value, context.assetInfo) || null
	}
	if (entry.kind === 'rules') {
		const rules = ruleTexts(value)
		return rules.length ? rules.join(t('；')) : null
	}
	if (entry.kind === 'resolve-mark') {
		const name = markName(value)
		return name || null
	}
	// rewrite/image：整段 NVS 或文件路径，没有可读形式，主视图不展示差异内容
	return null
}

function historyTarget(entry: HistoryEntry, assetInfo: AssetLabelInfo): string {
	if (entry.kind === 'expression' && typeof entry.next === 'string') {
		const base = entry.next.split('/').slice(0, -1).join('/')
		if (base) return formatAssetLabel(base, assetInfo)
	}
	if (entry.kind === 'expression' && typeof entry.previous === 'string') {
		const base = entry.previous.split('/').slice(0, -1).join('/')
		if (base) return formatAssetLabel(base, assetInfo)
	}
	if (entry.assetId) return formatAssetLabel(String(entry.assetId), assetInfo)
	return ''
}

export interface EditorPanelsProps {
	workId: string
	chapterId: string
	chapterIndex: number
	rulesRevision: string
	workRules: readonly string[]
	chapterRules: readonly string[]
	disabled: boolean
	revision: string
	historyOpen: boolean
	rulesOpen: boolean
	canUndo?: boolean
	customMarks: WorkSettings['customMarks']
	speakerNames: SpeakerNames
	assetInfo: AssetLabelInfo
	onCloseHistory(): void
	onCloseRules(): void
	onUndo?(): void
	run(action: () => Promise<void>): Promise<void>
	onSavedRules(
		scope: 'chapter' | 'work',
		revision: string,
		rules: string[],
	): void
}

export function EditorPanels({
	workId,
	chapterId,
	chapterIndex,
	rulesRevision,
	workRules,
	chapterRules,
	disabled,
	revision,
	historyOpen,
	rulesOpen,
	canUndo,
	customMarks,
	speakerNames,
	assetInfo,
	onCloseHistory,
	onCloseRules,
	onUndo,
	run,
	onSavedRules,
}: EditorPanelsProps) {
	const toast = useToast()
	const [history, setHistory] = useState<HistoryEntry[]>([])
	const [scope, setScope] = useState<'chapter' | 'work'>('chapter')
	const [ruleText, setRuleText] = useState('')

	useEffect(() => {
		if (!historyOpen) return
		let active = true
		setHistory([])
		void revision
		void window.novelive
			.call('editor.history', { workId, chapterId })
			.promise.then((result) => {
				if (active) setHistory(result.entries)
			})
			.catch(() => {})
		return () => {
			active = false
		}
	}, [historyOpen, workId, chapterId, revision])

	type RuleEntry = {
		scope: 'chapter' | 'work'
		index: number
		text: string
	}
	const allRules: RuleEntry[] = [
		...chapterRules.map(
			(text, index): RuleEntry => ({ scope: 'chapter', index, text }),
		),
		...workRules.map(
			(text, index): RuleEntry => ({ scope: 'work', index, text }),
		),
	]

	const saveRules = (
		ruleScope: 'chapter' | 'work',
		previous: readonly string[],
		next: string[],
		successToast: () => void,
	) =>
		void run(async () => {
			const saved = await window.novelive.call('editor.saveRules', {
				workId,
				expectedRevision: rulesRevision,
				target:
					ruleScope === 'chapter'
						? { scope: 'chapter' as const, chapterId }
						: { scope: 'work' as const },
				previous: [...previous],
				next,
			}).promise
			onSavedRules(ruleScope, saved.revision, saved.rules)
			successToast()
		})

	const handleAddRule = () => {
		const text = ruleText.trim()
		if (!text) return
		setRuleText('')
		const currentRules = scope === 'chapter' ? chapterRules : workRules
		const targetScope = scope
		saveRules(targetScope, currentRules, [...currentRules, text], () =>
			toast(
				targetScope === 'chapter' ? t('已存为本章规则') : t('已存为本作品规则'),
				BookmarkCheck,
			),
		)
	}

	const deleteRule = (ruleScope: 'chapter' | 'work', index: number) => {
		const currentRules = ruleScope === 'chapter' ? chapterRules : workRules
		saveRules(
			ruleScope,
			currentRules,
			currentRules.filter((_, i) => i !== index),
			() => toast(t('已删除规则'), Trash2),
		)
	}

	const context: DisplayContext = { speakerNames, customMarks, assetInfo }
	// 撤销作用在编辑器 undo 栈顶——最新一条还没被回退的创建者文本/表情
	// 修改。历史按时间倒序，undo 条目与被回退的修改严格嵌套（后进先出），
	// 所以从头数：每遇到一条 undo 记一个待配对，创建者条目先抵消掉配对的
	// 那条才是按钮真正回退的目标。按钮只挂在这一条上，其余条目不出现。
	const undoable = (entry: HistoryEntry) =>
		entry.kind === 'text' || entry.kind === 'expression'
	let undoTargetId: string | undefined
	if (canUndo && onUndo) {
		let reversed = 0
		for (const entry of history) {
			if (!undoable(entry)) continue
			if (entry.origin === 'undo') {
				reversed += 1
				continue
			}
			if (entry.origin !== 'creator') continue
			if (reversed > 0) {
				reversed -= 1
				continue
			}
			undoTargetId = entry.id
			break
		}
	}

	return (
		<>
			<Drawer
				open={historyOpen}
				title={t('修改历史')}
				onClose={onCloseHistory}
				width={380}
			>
				<section aria-label={t('修改历史')} className="editor-history-list">
					{history.length ? (
						history.map((entry) => {
							const target = historyTarget(entry, assetInfo)
							const previous = historyValue(entry, 'previous', context)
							const next = historyValue(entry, 'next', context)
							return (
								<div key={entry.id} className="glass-panel editor-history-card">
									<div className="editor-history-desc">
										{t(originLabel[entry.origin] ?? msg('其他'))}
										{' · '}
										{t(kindLabel[entry.kind] ?? msg('修改'))}
									</div>
									<div className="editor-history-meta">
										{formatHistoryTime(entry.at)}
										{target ? ` · ${target}` : ''}
									</div>
									{previous !== null && (
										<del className="editor-history-old">{previous}</del>
									)}
									{next !== null && (
										<ins className="editor-history-new">{next}</ins>
									)}
									{undoTargetId === entry.id && onUndo ? (
										<Button
											size="sm"
											variant="ghost"
											icon={Undo2}
											disabled={disabled}
											onClick={onUndo}
										>
											{t('撤销这一步')}
										</Button>
									) : null}
								</div>
							)
						})
					) : (
						<EmptyState
							icon={History}
							title={t('还没有修改')}
							text={t('每步修改都可撤销。')}
						/>
					)}
				</section>
			</Drawer>
			<Modal
				open={rulesOpen}
				title={t('存为规则')}
				onClose={onCloseRules}
				width={520}
				footer={
					<>
						<Button variant="ghost" onClick={onCloseRules}>
							{t('取消')}
						</Button>
						<Button
							variant="primary"
							icon={BookmarkCheck}
							disabled={!ruleText.trim() || disabled}
							onClick={handleAddRule}
						>
							{t('保存规则')}
						</Button>
					</>
				}
			>
				<div className="editor-rules-body">
					<Field label={t('作用域')}>
						<RadioGroup
							value={scope}
							onChange={(v) => setScope(v as 'chapter' | 'work')}
							disabled={disabled}
							options={[
								{
									value: 'chapter',
									label: chapterIndex
										? t('本章（第 {{index}} 章）', { index: chapterIndex })
										: t('本章规则'),
								},
								{ value: 'work', label: t('本作品') },
							]}
						/>
					</Field>
					<Field label={t('规则内容')}>
						<Textarea
							aria-label={t('规则内容')}
							rows={3}
							value={ruleText}
							disabled={disabled}
							onChange={setRuleText}
							placeholder={t('例：这一幕之后，凛不再主动提起灯塔')}
						/>
					</Field>
					<Banner kind="info">
						{t('新规则只影响还没开始的任务；已经做完或在做的章节不受影响。')}
					</Banner>
					{allRules.length ? (
						<>
							<SectionLabel>{t('已存规则')}</SectionLabel>
							{allRules.map((r) => (
								<div
									key={`${r.scope}-${r.index}`}
									className="hover-row editor-rule-row"
								>
									<Chip>{r.scope === 'chapter' ? t('本章') : t('本作品')}</Chip>
									<span className="editor-rule-text">{r.text}</span>
									<div className="row-actions">
										<IconButton
											icon={Trash2}
											size={28}
											iconSize={14}
											label={t('删除规则 {{value}}', { value: r.text })}
											disabled={disabled}
											onClick={() => deleteRule(r.scope, r.index)}
										/>
									</div>
								</div>
							))}
						</>
					) : null}
				</div>
			</Modal>
		</>
	)
}
