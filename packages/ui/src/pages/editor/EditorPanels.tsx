import type { CommandOutput } from '@novelive/creator/contract'
import { BookmarkCheck, History, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, IconButton } from '../../components/Button'
import { Chip, SectionLabel } from '../../components/Card'
import { Banner, Drawer, RadioGroup } from '../../components/Extended'
import { Field, Textarea } from '../../components/Form'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { msg, scoped } from '../../i18n'

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

// `previous`/`next` are JSON-encoded for rules and resolve-mark entries;
// decode them into something readable instead of printing raw JSON.
function readable(value: unknown): string {
	if (Array.isArray(value)) return value.join(', ')
	if (value && typeof value === 'object') {
		if ('name' in value && typeof value.name === 'string') return value.name
		if ('css' in value && typeof value.css === 'string') return value.css
		return JSON.stringify(value)
	}
	return String(value)
}
function historyValue(entry: HistoryEntry, field: 'previous' | 'next') {
	const raw: unknown = entry[field]
	if (raw === null) return null
	if (typeof raw !== 'string') return readable(raw)
	if (entry.kind !== 'rules' && entry.kind !== 'resolve-mark') return raw
	try {
		return readable(JSON.parse(raw))
	} catch {
		return raw
	}
}

function formatHistoryTime(at: string): string {
	const date = new Date(at)
	if (Number.isNaN(date.getTime())) return at
	return date.toLocaleString(undefined, {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
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
						history.map((entry, index) => {
							const target = entry.assetId
								? String(entry.assetId)
								: entry.lineId
									? `#${entry.lineId}`
									: ''
							return (
								<div key={entry.id} className="glass-panel editor-history-card">
									<div className="editor-history-desc">
										{t(originLabel[entry.origin] ?? entry.origin)}
										{' · '}
										{t(kindLabel[entry.kind] ?? entry.kind)}
									</div>
									<div className="editor-history-meta">
										{formatHistoryTime(entry.at)}
										{target ? ` · ${target}` : ''}
									</div>
									{historyValue(entry, 'previous') !== null && (
										<del className="editor-history-old">
											{historyValue(entry, 'previous')}
										</del>
									)}
									{historyValue(entry, 'next') !== null && (
										<ins className="editor-history-new">
											{historyValue(entry, 'next')}
										</ins>
									)}
									{index === 0 &&
										canUndo &&
										onUndo &&
										entry.origin === 'creator' &&
										(entry.kind === 'text' || entry.kind === 'expression') && (
											<Button
												size="sm"
												variant="ghost"
												icon={Undo2}
												disabled={disabled}
												onClick={onUndo}
											>
												{t('撤销')}
											</Button>
										)}
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
