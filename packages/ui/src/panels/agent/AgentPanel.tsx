import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Maximize2,
	MessageCircle,
	Minimize2,
	Pencil,
	Plus,
	Sparkles,
	Trash2,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/Button'
import { Collapse } from '../../components/Collapse'
import { ConfirmDialog, Tooltip } from '../../components/Extended'
import { Modal } from '../../components/Modal'
import { ScrollArea } from '../../components/ScrollArea'
import { scoped } from '../../i18n'
import styles from './AgentPanel.module.css'
import { Composer } from './Composer'
import {
	type Activity,
	MessageParts,
	type ProposalActions,
	ScrollField,
	StreamingPlaceholder,
	SummaryDivider,
} from './MessageView'
import {
	branchPath,
	type ChatSession,
	headWithin,
	type Message,
	type Position,
	siblingsOf,
	useAgentChat,
} from './session'

const t = scoped('agent')

type Chat = ReturnType<typeof useAgentChat>

function RenameInput({
	initial,
	onCancel,
	onSend,
}: {
	initial: string
	onCancel(): void
	onSend(title: string): void
}) {
	const [title, setTitle] = useState(initial)
	return (
		<form
			className={styles.renameForm}
			onSubmit={(event) => {
				event.preventDefault()
				if (title.trim()) onSend(title.trim())
				else onCancel()
			}}
		>
			<input
				// biome-ignore lint/a11y/noAutofocus: 点了重命名就该能直接打字
				autoFocus
				className={`nl-input ${styles.field}`}
				aria-label={t('会话名称')}
				value={title}
				onChange={(event) => setTitle(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						event.stopPropagation()
						onCancel()
					}
				}}
				onBlur={onCancel}
				onClick={(event) => event.stopPropagation()}
			/>
		</form>
	)
}

function SessionMenu({
	chat,
	onDelete,
	onClose,
}: {
	chat: Chat
	onDelete(session: ChatSession): void
	onClose(): void
}) {
	const [renaming, setRenaming] = useState<string>()
	const current = chat.snapshot?.session.sessionId
	const guard = (action: Promise<unknown>, message: string) =>
		void action.catch(() => chat.setError(message))
	return (
		<>
			<button
				type="button"
				className={styles.menuItem}
				onClick={() => {
					void chat.create()
					onClose()
				}}
			>
				<Plus aria-hidden="true" size={15} strokeWidth={1.8} /> {t('新会话')}
			</button>
			<ScrollArea className={styles.menuScroll}>
				<ul aria-label={t('会话')} className={styles.menuList}>
					{chat.sessions.map((session) => (
						<li key={session.sessionId} className="hover-row">
							{renaming === session.sessionId ? (
								<RenameInput
									initial={session.title}
									onCancel={() => setRenaming(undefined)}
									onSend={(next) => {
										setRenaming(undefined)
										guard(chat.rename(session.sessionId, next), t('没能重命名'))
									}}
								/>
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
										<MessageCircle
											aria-hidden="true"
											size={14}
											strokeWidth={1.8}
											className={styles.sessionIcon}
										/>
										{session.title}
									</button>
									<span className={`row-actions ${styles.rowActions}`}>
										<button
											type="button"
											className={styles.iconButton}
											aria-label={t('重命名 {{title}}', {
												title: session.title,
											})}
											title={t('重命名 {{title}}', { title: session.title })}
											onClick={() => setRenaming(session.sessionId)}
										>
											<Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
										</button>
										<button
											type="button"
											className={styles.iconButton}
											aria-label={t('删除 {{title}}', { title: session.title })}
											title={t('删除 {{title}}', { title: session.title })}
											onClick={() => onDelete(session)}
										>
											<Trash2 aria-hidden="true" size={13} strokeWidth={1.8} />
										</button>
									</span>
								</>
							)}
						</li>
					))}
				</ul>
			</ScrollArea>
		</>
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
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						event.stopPropagation()
						onCancel()
					}
				}}
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

function contextLabelOf(
	position: Position | undefined,
	chapterTitles: Record<string, string>,
): string | null {
	if (!position) return null
	if (position.kind === 'editor') {
		const chapter = chapterTitles[position.chapterId] ?? position.chapterId
		return position.sourceIds?.length
			? t('编辑器 · {{chapter}} · {{count}} 段', {
					chapter,
					count: position.sourceIds.length,
				})
			: t('编辑器 · {{chapter}}', { chapter })
	}
	return position.entryId
		? t('设定集 · {{entry}}', { entry: position.entryId })
		: t('设定集')
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
	const [renamingCurrent, setRenamingCurrent] = useState(false)
	const [editing, setEditing] = useState<string>()
	const [preview, setPreview] = useState<{ src: string; name: string }>()
	const [deleting, setDeleting] = useState<ChatSession>()
	const [composerExpanded, setComposerExpanded] = useState(false)
	const [detached, setDetached] = useState(false)
	const panel = useRef<HTMLElement>(null)
	const end = useRef<HTMLDivElement>(null)
	const path = snapshot ? branchPath(snapshot.entries, snapshot.headId) : []
	const streaming = snapshot?.status === 'streaming'
	const last = path.at(-1)
	const positionKey = JSON.stringify(position ?? null)

	useEffect(() => panel.current?.focus(), [])
	// biome-ignore lint/correctness/useExhaustiveDependencies: 位置变化时重新附带
	useEffect(() => {
		setDetached(false)
	}, [positionKey])
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
	) => chat.send(text, attachmentIds, parentId, detached ? undefined : position)
	const contextLabel = detached
		? null
		: contextLabelOf(position, chat.chapterTitles)
	const awaiting =
		streaming && (last?.kind !== 'message' || last.role === 'user')

	return (
		<aside
			ref={panel}
			tabIndex={-1}
			className={styles.panel}
			data-full={full}
			aria-label="Agent"
			onKeyDown={(event) => {
				if (event.key !== 'Escape') return
				if (event.defaultPrevented) return
				if (preview || deleting) return
				event.preventDefault()
				if (composerExpanded) setComposerExpanded(false)
				else if (menu) setMenu(false)
				else if (full) onToggleFull()
				else onClose()
			}}
		>
			<header className={styles.header}>
				<span className={styles.badge} aria-hidden="true">
					<Sparkles size={17} strokeWidth={1.8} />
				</span>
				{renamingCurrent && snapshot ? (
					<RenameInput
						initial={snapshot.session.title}
						onCancel={() => setRenamingCurrent(false)}
						onSend={(next) => {
							setRenamingCurrent(false)
							void chat
								.rename(snapshot.session.sessionId, next)
								.catch(() => chat.setError(t('没能重命名')))
						}}
					/>
				) : (
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
						<span className="nl-chevron" data-open={menu}>
							<ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
						</span>
					</button>
				)}
				<Tooltip text={t('重命名会话')}>
					<IconButton
						icon={Pencil}
						label={t('重命名会话')}
						size={28}
						iconSize={15}
						disabled={!snapshot || renamingCurrent}
						onClick={() => setRenamingCurrent(true)}
					/>
				</Tooltip>
				<Tooltip text={full ? t('退出全屏') : t('全屏')}>
					<button
						type="button"
						className={styles.iconButton}
						aria-label={full ? t('退出全屏') : t('全屏')}
						onClick={onToggleFull}
					>
						{full ? (
							<Minimize2 aria-hidden="true" size={16} strokeWidth={1.8} />
						) : (
							<Maximize2 aria-hidden="true" size={16} strokeWidth={1.8} />
						)}
					</button>
				</Tooltip>
				<Tooltip text={t('关闭（Ctrl/⌘+J）')}>
					<button
						type="button"
						className={styles.iconButton}
						aria-label={t('关闭 Agent')}
						onClick={onClose}
					>
						<X aria-hidden="true" size={16} strokeWidth={1.8} />
					</button>
				</Tooltip>
			</header>
			<Collapse open={menu} className={styles.menuCollapse}>
				<div className={styles.menu}>
					<SessionMenu
						chat={chat}
						onDelete={(session) => {
							setDeleting(session)
							setMenu(false)
						}}
						onClose={() => setMenu(false)}
					/>
				</div>
			</Collapse>
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
									<SummaryDivider
										key={entry.id}
										kind={entry.kind}
										summary={entry.summary}
									/>
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
												mine={entry.role === 'user'}
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
													<ChevronLeft
														aria-hidden="true"
														size={14}
														strokeWidth={1.8}
													/>
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
													<ChevronRight
														aria-hidden="true"
														size={14}
														strokeWidth={1.8}
													/>
												</button>
											</nav>
										)}
										{entry.role === 'user' && text && editing !== entry.id && (
											<Tooltip text={t('编辑后重新发送')}>
												<button
													type="button"
													className={styles.iconButton}
													aria-label={t('编辑后重新发送')}
													disabled={streaming}
													onClick={() => setEditing(entry.id)}
												>
													<Pencil
														aria-hidden="true"
														size={14}
														strokeWidth={1.8}
													/>
												</button>
											</Tooltip>
										)}
									</div>
								</article>
							)
						})}
					{awaiting && (
						<article
							className={styles.message}
							data-role="assistant"
							aria-label={t('Agent 回复')}
						>
							<StreamingPlaceholder />
						</article>
					)}
					<div ref={end} />
				</div>
			</ScrollArea>
			{chat.error && (
				<p className={styles.error} role="alert">
					{chat.error}
				</p>
			)}
			<Composer
				streaming={streaming ?? false}
				sessionId={snapshot?.session.sessionId ?? null}
				disabled={!chat.loaded}
				contextLabel={contextLabel}
				expanded={composerExpanded}
				onExpandedChange={setComposerExpanded}
				onDetachContext={() => setDetached(true)}
				onAttach={chat.attach}
				onSend={(text, ids) => send(text, ids, snapshot?.headId ?? null)}
				onStop={() =>
					void chat.stop().catch(() => chat.setError(t('没能停止')))
				}
				onPreview={(src, name) => setPreview({ src, name })}
			/>
			<ConfirmDialog
				open={Boolean(deleting)}
				title={t('删除会话')}
				message={
					deleting
						? t('删除「{{title}}」后，这个会话里的消息记录都找不回来了。', {
								title: deleting.title,
							})
						: ''
				}
				confirmLabel={t('删除')}
				danger
				onConfirm={() => {
					if (deleting)
						void chat
							.remove(deleting.sessionId)
							.catch(() => chat.setError(t('没能删除')))
					setDeleting(undefined)
				}}
				onCancel={() => setDeleting(undefined)}
			/>
			<Modal
				open={Boolean(preview)}
				title={preview?.name || t('图片预览')}
				onClose={() => setPreview(undefined)}
				width={760}
			>
				{preview && (
					<div className={styles.previewFrame}>
						<img
							src={preview.src}
							alt={preview.name}
							className={styles.previewImage}
						/>
					</div>
				)}
			</Modal>
		</aside>
	)
}
