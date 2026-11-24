import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Maximize2,
	Minimize2,
	Pencil,
	Plus,
	Sparkles,
	Trash2,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '../../components/ScrollArea'
import { scoped } from '../../i18n'
import styles from './AgentPanel.module.css'
import { Composer } from './Composer'
import {
	type Activity,
	MessageParts,
	type ProposalActions,
	ScrollField,
} from './MessageView'
import {
	branchPath,
	headWithin,
	type Message,
	type Position,
	siblingsOf,
	useAgentChat,
} from './session'

const t = scoped('agent')

type Chat = ReturnType<typeof useAgentChat>

function SessionMenu({ chat, onClose }: { chat: Chat; onClose(): void }) {
	const [renaming, setRenaming] = useState<string>()
	const [title, setTitle] = useState('')
	const [deleting, setDeleting] = useState<string>()
	const current = chat.snapshot?.session.sessionId
	const guard = (action: Promise<unknown>, message: string) =>
		void action.catch(() => chat.setError(message))
	return (
		<div className={styles.menu}>
			<button
				type="button"
				className={styles.menuItem}
				onClick={() => {
					void chat.create()
					onClose()
				}}
			>
				<Plus aria-hidden="true" size={15} /> {t('新会话')}
			</button>
			<ScrollArea className={styles.menuScroll}>
				<ul aria-label={t('会话')} className={styles.menuList}>
					{chat.sessions.map((session) => (
						<li key={session.sessionId} className={styles.sessionRow}>
							{renaming === session.sessionId ? (
								<form
									className={styles.renameForm}
									onSubmit={(event) => {
										event.preventDefault()
										if (title.trim())
											guard(
												chat.rename(session.sessionId, title.trim()),
												t('没能重命名'),
											)
										setRenaming(undefined)
									}}
								>
									<input
										// biome-ignore lint/a11y/noAutofocus: 点了重命名就该能直接打字
										autoFocus
										className={styles.field}
										aria-label={t('会话名称')}
										value={title}
										onChange={(event) => setTitle(event.target.value)}
										onBlur={() => setRenaming(undefined)}
									/>
								</form>
							) : deleting === session.sessionId ? (
								<div className={styles.renameForm}>
									<span className={styles.cardTitle}>
										{t('删除「{{title}}」？', { title: session.title })}
									</span>
									<button
										type="button"
										className={styles.button}
										onClick={() => setDeleting(undefined)}
									>
										{t('取消')}
									</button>
									<button
										type="button"
										className={styles.danger}
										onClick={() => {
											guard(chat.remove(session.sessionId), t('没能删除'))
											setDeleting(undefined)
										}}
									>
										{t('删除')}
									</button>
								</div>
							) : (
								<>
									<button
										type="button"
										className={styles.menuItem}
										aria-current={session.sessionId === current}
										onClick={() => {
											void chat.open(session.sessionId)
											onClose()
										}}
									>
										{session.title}
									</button>
									<button
										type="button"
										className={styles.iconButton}
										aria-label={t('重命名 {{title}}', { title: session.title })}
										onClick={() => {
											setTitle(session.title)
											setRenaming(session.sessionId)
										}}
									>
										<Pencil aria-hidden="true" size={14} />
									</button>
									<button
										type="button"
										className={styles.iconButton}
										aria-label={t('删除 {{title}}', { title: session.title })}
										onClick={() => setDeleting(session.sessionId)}
									>
										<Trash2 aria-hidden="true" size={14} />
									</button>
								</>
							)}
						</li>
					))}
				</ul>
			</ScrollArea>
		</div>
	)
}

function EditBox({
	initial,
	allowEmpty,
	onCancel,
	onSend,
}: {
	initial: string
	allowEmpty: boolean
	onCancel(): void
	onSend(text: string): void
}) {
	const [text, setText] = useState(initial)
	return (
		<div className={styles.editBox}>
			<ScrollField
				autoFocus
				aria-label={t('编辑消息')}
				rows={3}
				value={text}
				onChange={(event) => setText(event.target.value)}
			/>
			<div className={styles.actions}>
				<button type="button" className={styles.button} onClick={onCancel}>
					{t('取消')}
				</button>
				<button
					type="button"
					className={styles.primary}
					disabled={!allowEmpty && !text.trim()}
					onClick={() => onSend(text.trim())}
				>
					{t('重新发送')}
				</button>
			</div>
		</div>
	)
}

export function AgentPanel({
	workId,
	full,
	position,
	onToggleFull,
	onClose,
}: {
	workId: string
	full: boolean
	position?: Position
	onToggleFull(): void
	onClose(): void
}) {
	const chat = useAgentChat(workId)
	const { snapshot } = chat
	const [menu, setMenu] = useState(false)
	const [editing, setEditing] = useState<string>()
	const [preview, setPreview] = useState<{ src: string; name: string }>()
	const panel = useRef<HTMLElement>(null)
	const dialog = useRef<HTMLDialogElement>(null)
	const end = useRef<HTMLDivElement>(null)
	const path = snapshot ? branchPath(snapshot.entries, snapshot.headId) : []
	const streaming = snapshot?.status === 'streaming'
	const last = path.at(-1)

	useEffect(() => panel.current?.focus(), [])
	useEffect(() => {
		if (preview) dialog.current?.showModal()
	}, [preview])
	// biome-ignore lint/correctness/useExhaustiveDependencies: 新内容到达时贴底
	useEffect(() => {
		end.current?.scrollIntoView({ block: 'end' })
	}, [snapshot])

	const actions: ProposalActions = {
		chapterTitles: chat.chapterTitles,
		resolve: (proposal, decision) => chat.resolve(proposal.id, decision),
	}
	const activityOf = (message: Message): Activity =>
		streaming && message.id === last?.id
			? 'streaming'
			: chat.stopped.has(message.id)
				? 'stopped'
				: 'idle'
	const send = (
		text: string,
		attachmentIds: string[],
		parentId: string | null,
	) => chat.send(text, attachmentIds, parentId, position)

	return (
		<aside
			ref={panel}
			tabIndex={-1}
			className={styles.panel}
			data-full={full}
			aria-label="Agent"
			onKeyDown={(event) => {
				if (event.key !== 'Escape' || dialog.current?.open) return
				event.preventDefault()
				if (menu) setMenu(false)
				else if (full) onToggleFull()
				else onClose()
			}}
		>
			<header className={styles.header}>
				<span className={styles.badge} aria-hidden="true">
					<Sparkles size={17} strokeWidth={1.8} />
				</span>
				<button
					type="button"
					className={styles.sessionButton}
					aria-expanded={menu}
					aria-label={t('切换会话')}
					onClick={() => setMenu(!menu)}
				>
					<span className={styles.sessionTitle}>
						{snapshot?.session.title ?? t('新会话')}
					</span>
					<ChevronDown aria-hidden="true" size={15} />
				</button>
				<button
					type="button"
					className={styles.iconButton}
					aria-label={full ? t('退出全屏') : t('全屏')}
					title={full ? t('退出全屏') : t('全屏')}
					onClick={onToggleFull}
				>
					{full ? (
						<Minimize2 aria-hidden="true" size={16} />
					) : (
						<Maximize2 aria-hidden="true" size={16} />
					)}
				</button>
				<button
					type="button"
					className={styles.iconButton}
					aria-label={t('关闭 Agent')}
					title={t('关闭（Ctrl/⌘+J）')}
					onClick={onClose}
				>
					<X aria-hidden="true" size={16} />
				</button>
				{menu && <SessionMenu chat={chat} onClose={() => setMenu(false)} />}
			</header>
			<ScrollArea className={styles.thread}>
				<div className={styles.messages}>
					{chat.loaded && path.length === 0 && (
						<p className={styles.empty}>
							{t(
								'可以让 Agent 改设定、调术语、重写场景或重做章节，所有改动都会先给你确认。',
							)}
						</p>
					)}
					{snapshot &&
						path.map((entry) => {
							if (entry.kind !== 'message')
								return (
									<details key={entry.id} className={styles.summary}>
										<summary>
											{entry.kind === 'compaction'
												? t('较早的内容已压缩成摘要')
												: t('另一条分支的摘要')}
										</summary>
										<p>{entry.summary}</p>
									</details>
								)
							const siblings = siblingsOf(snapshot.entries, entry)
							const index = siblings.findIndex((other) => other.id === entry.id)
							const text = entry.parts
								.map((part) => (part.type === 'text' ? part.text : ''))
								.join('')
							const images = entry.parts.flatMap((part) =>
								part.type === 'image' ? [part.attachment.id] : [],
							)
							const go = (offset: number) => {
								const target = siblings[index + offset]
								if (target)
									void chat.open(
										snapshot.session.sessionId,
										headWithin(snapshot, target.id),
									)
							}
							return (
								<article
									key={entry.id}
									className={styles.message}
									data-role={entry.role}
									aria-label={
										entry.role === 'user' ? t('我的消息') : t('Agent 回复')
									}
								>
									{editing === entry.id ? (
										<EditBox
											initial={text}
											allowEmpty={images.length > 0}
											onCancel={() => setEditing(undefined)}
											onSend={(next) => {
												setEditing(undefined)
												void send(next, images, entry.parentId).catch(() =>
													chat.setError(t('没能重新发送')),
												)
											}}
										/>
									) : (
										<div className={styles.bubble}>
											<MessageParts
												parts={entry.parts}
												activity={activityOf(entry)}
												actions={actions}
												onPreview={(attachment) =>
													setPreview({
														src: window.novelive.resourceUrl(
															attachment.cachePath,
														),
														name: attachment.name,
													})
												}
											/>
										</div>
									)}
									<div className={styles.messageTools}>
										{siblings.length > 1 && (
											<nav className={styles.branches} aria-label={t('分支')}>
												<button
													type="button"
													className={styles.iconButton}
													aria-label={t('上一个分支')}
													disabled={index === 0 || streaming}
													onClick={() => go(-1)}
												>
													<ChevronLeft aria-hidden="true" size={14} />
												</button>
												<span className={styles.caption}>
													{index + 1}/{siblings.length}
												</span>
												<button
													type="button"
													className={styles.iconButton}
													aria-label={t('下一个分支')}
													disabled={index === siblings.length - 1 || streaming}
													onClick={() => go(1)}
												>
													<ChevronRight aria-hidden="true" size={14} />
												</button>
											</nav>
										)}
										{entry.role === 'user' && text && editing !== entry.id && (
											<button
												type="button"
												className={styles.iconButton}
												aria-label={t('编辑后重新发送')}
												title={t('编辑后重新发送')}
												disabled={streaming}
												onClick={() => setEditing(entry.id)}
											>
												<Pencil aria-hidden="true" size={14} />
											</button>
										)}
									</div>
								</article>
							)
						})}
					<div ref={end} />
				</div>
			</ScrollArea>
			{chat.error && (
				<p className={styles.error} role="alert">
					{chat.error}
				</p>
			)}
			<Composer
				streaming={streaming}
				sessionId={snapshot?.session.sessionId ?? null}
				disabled={!chat.loaded}
				onAttach={chat.attach}
				onSend={(text, ids) => send(text, ids, snapshot?.headId ?? null)}
				onStop={() =>
					void chat.stop().catch(() => chat.setError(t('没能停止')))
				}
				onPreview={(src, name) => setPreview({ src, name })}
			/>
			{preview && (
				<dialog
					ref={dialog}
					className={styles.preview}
					aria-label={preview.name}
					onClose={() => setPreview(undefined)}
				>
					<img src={preview.src} alt={preview.name} />
					<button
						type="button"
						className={styles.iconButton}
						aria-label={t('关闭预览')}
						onClick={() => dialog.current?.close()}
					>
						<X aria-hidden="true" size={16} />
					</button>
				</dialog>
			)}
		</aside>
	)
}
