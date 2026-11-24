import type { CommandOutput } from '@novelive/creator/contract'
import { useEffect, useState } from 'react'
import { ScrollArea } from '../../components/ScrollArea'
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
}
// `previous`/`next` are JSON-encoded for rules and resolve-mark entries;
// decode them into something readable instead of printing raw JSON.
function readable(value: unknown): string {
	if (Array.isArray(value)) return value.join(', ')
	if (value && typeof value === 'object')
		return (
			(value as { name?: string }).name ??
			(value as { css?: string }).css ??
			JSON.stringify(value)
		)
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

export function EditorPanels({
	workId,
	chapterId,
	rulesRevision,
	workRules,
	chapterRules,
	disabled,
	revision,
	run,
	onSavedRules,
}: {
	workId: string
	chapterId: string
	rulesRevision: string
	workRules: readonly string[]
	chapterRules: readonly string[]
	disabled: boolean
	revision: string
	run(action: () => Promise<void>): Promise<void>
	onSavedRules(
		scope: 'chapter' | 'work',
		revision: string,
		rules: string[],
	): void
}) {
	const [showHistory, setShowHistory] = useState(false)
	const [history, setHistory] = useState<HistoryEntry[]>([])
	const [showRules, setShowRules] = useState(false)
	const [scope, setScope] = useState<'chapter' | 'work'>('chapter')
	const [ruleText, setRuleText] = useState('')
	useEffect(() => {
		if (!showHistory) return
		let active = true
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
	}, [showHistory, workId, chapterId, revision])
	const currentRules = scope === 'chapter' ? chapterRules : workRules
	const saveRuleList = (next: string[]) =>
		void run(async () => {
			const saved = await window.novelive.call('editor.saveRules', {
				workId,
				expectedRevision: rulesRevision,
				target: scope === 'chapter' ? { scope, chapterId } : { scope },
				previous: [...currentRules],
				next,
			}).promise
			onSavedRules(scope, saved.revision, saved.rules)
		})
	return (
		<>
			<div className="editor-toolbar">
				<button
					type="button"
					aria-expanded={showHistory}
					disabled={disabled}
					onClick={() => setShowHistory((value) => !value)}
				>
					{t('修改历史')}
				</button>
				<button
					type="button"
					aria-expanded={showRules}
					disabled={disabled}
					onClick={() => setShowRules((value) => !value)}
				>
					{t('规则')}
				</button>
			</div>
			{showHistory && (
				<section className="editor-drawer" aria-label={t('修改历史')}>
					<h3>{t('修改历史')}</h3>
					<ScrollArea className="editor-drawer-scroll">
						{history.length ? (
							<ul className="editor-list">
								{history.map((entry) => (
									<li key={entry.id}>
										<strong>
											{t(originLabel[entry.origin] ?? entry.origin)} ·{' '}
											{t(kindLabel[entry.kind] ?? entry.kind)}
										</strong>
										<span>{entry.at}</span>
										{historyValue(entry, 'previous') !== null && (
											<del>{historyValue(entry, 'previous')}</del>
										)}
										{historyValue(entry, 'next') !== null && (
											<ins>{historyValue(entry, 'next')}</ins>
										)}
									</li>
								))}
							</ul>
						) : (
							<p>{t('暂无修改历史')}</p>
						)}
					</ScrollArea>
				</section>
			)}
			{showRules && (
				<section className="editor-drawer" aria-label={t('规则')}>
					<h3>{t('规则')}</h3>
					<div className="editor-toolbar">
						<label>
							{t('作用范围')}
							<select
								aria-label={t('作用范围')}
								value={scope}
								disabled={disabled}
								onChange={(event) =>
									setScope(event.target.value as 'chapter' | 'work')
								}
							>
								<option value="chapter">{t('本章规则')}</option>
								<option value="work">{t('本作品规则')}</option>
							</select>
						</label>
						<input
							aria-label={t('规则内容')}
							value={ruleText}
							disabled={disabled}
							onChange={(event) => setRuleText(event.target.value)}
							placeholder={t('规则内容')}
						/>
						<button
							type="button"
							disabled={!ruleText.trim() || disabled}
							onClick={() => {
								const text = ruleText.trim()
								setRuleText('')
								saveRuleList([...currentRules, text])
							}}
						>
							{t('添加规则')}
						</button>
					</div>
					<ScrollArea className="editor-drawer-scroll">
						{currentRules.length ? (
							<ul className="editor-list">
								{(() => {
									const seen = new Map<string, number>()
									return currentRules.map((rule, index) => {
										const count = (seen.get(rule) ?? 0) + 1
										seen.set(rule, count)
										return (
											<li key={`${scope}-${rule}-${count}`}>
												<span>{rule}</span>
												<button
													type="button"
													disabled={disabled}
													aria-label={t('删除规则 {{value}}', { value: rule })}
													onClick={() =>
														saveRuleList(
															currentRules.filter((_, i) => i !== index),
														)
													}
												>
													{t('删除规则')}
												</button>
											</li>
										)
									})
								})()}
							</ul>
						) : (
							<p>{t('暂无规则')}</p>
						)}
					</ScrollArea>
				</section>
			)}
		</>
	)
}
