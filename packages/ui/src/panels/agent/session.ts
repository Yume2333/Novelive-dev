import type {
	CommandInput,
	CommandOutput,
	EventEnvelope,
} from '@novelive/creator/contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	type AssetLabelInfo,
	assetLabelInfoFromBible,
} from '../../format/asset'
import { scoped } from '../../i18n'

const t = scoped('agent')

export type Snapshot = CommandOutput<'chat.get'>
export type ChatSession = Snapshot['session']
export type Entry = Snapshot['entries'][number]
export type Message = Extract<Entry, { kind: 'message' }>
export type EntryNames = Readonly<Record<string, string>>
export type ChapterOrder = Readonly<Record<string, number>>

function collectEntryNames(
	bible: CommandOutput<'bible.get'> | null,
): Record<string, string> {
	const names: Record<string, string> = {}
	if (!bible) return names
	const characterNames = Object.fromEntries(
		bible.characters.map((entry) => [entry.id, entry.name]),
	)
	for (const entry of bible.characters)
		if (entry.name) names[entry.id] = entry.name
	for (const entry of bible.locations)
		if (entry.name) names[entry.id] = entry.name
	for (const entry of bible.relations) {
		const from = characterNames[entry.from]
		const to = characterNames[entry.to]
		if (from && to) names[entry.id] = `${from} / ${to}`
	}
	for (const entry of bible.glossary) {
		const label = entry.written || entry.original
		if (label) names[entry.id] = label
	}
	for (const entry of bible.timeline)
		if (entry.event) names[entry.id] = entry.event
	for (const entry of bible.foreshadowing)
		if (entry.description) names[entry.id] = entry.description
	for (const entry of bible.styles)
		if (entry.description) names[entry.id] = entry.description
	return names
}
export type Part = Message['parts'][number]
export type Attachment = CommandOutput<'chat.attach'>
export type Position = CommandInput<'chat.send'>['position']
type MessageEvent = {
	workId: string
	sessionId: string
	headId: string
	message: Message
	status: 'streaming' | 'done' | 'cancelled' | 'failed'
}

/** 从某个末端向上走到根，返回根在前的一条分支 */
export function branchPath(entries: Entry[], headId: string | null) {
	const byId = new Map(entries.map((entry) => [entry.id, entry]))
	const path: Entry[] = []
	for (let id = headId; id; id = byId.get(id)?.parentId ?? null) {
		const entry = byId.get(id)
		if (!entry) break
		path.unshift(entry)
	}
	return path
}

export function siblingsOf(entries: Entry[], entry: Entry) {
	return entries.filter(
		(other) => other.kind === 'message' && other.parentId === entry.parentId,
	)
}

/** 切到某条兄弟消息时，落在包含它的最新末端上 */
export function headWithin(snapshot: Snapshot, entryId: string) {
	return (
		snapshot.headIds.findLast((head) =>
			branchPath(snapshot.entries, head).some((entry) => entry.id === entryId),
		) ?? entryId
	)
}

export function mergeMessage(snapshot: Snapshot, event: MessageEvent) {
	const { message } = event
	const exists = snapshot.entries.some((entry) => entry.id === message.id)
	const entries = exists
		? snapshot.entries.map((entry) =>
				entry.id === message.id ? message : entry,
			)
		: [...snapshot.entries, message]
	const followsHead =
		snapshot.headId === null ||
		branchPath(entries, event.headId).some(
			(entry) => entry.id === snapshot.headId,
		)
	return {
		...snapshot,
		entries,
		headId: followsHead ? event.headId : snapshot.headId,
		headIds: [
			...snapshot.headIds.filter(
				(head) => head !== message.parentId && head !== event.headId,
			),
			event.headId,
		],
		status: event.status === 'streaming' ? 'streaming' : 'idle',
	} satisfies Snapshot
}

/** 发送后读回的快照可能比已到的流式事件旧：保留已经长在新消息之后的内容 */
function settle(latest: Snapshot | null, next: Snapshot, headId: string) {
	if (latest?.session.sessionId !== next.session.sessionId) return next
	const known = new Set(next.entries.map((entry) => entry.id))
	const entries = [
		...next.entries,
		...latest.entries.filter((entry) => !known.has(entry.id)),
	]
	const grown = [latest.headId, ...latest.headIds].findLast(
		(head) =>
			head !== headId &&
			branchPath(entries, head).some((entry) => entry.id === headId),
	)
	if (!grown) return next
	return {
		...next,
		entries,
		headId: grown,
		headIds: [...new Set([...next.headIds, ...latest.headIds])].filter(
			(head) => head !== headId,
		),
		status: latest.status,
	}
}

function call<K extends Parameters<typeof window.novelive.call>[0]>(
	command: K,
	payload: CommandInput<K>,
) {
	return window.novelive.call(command, payload).promise
}

export function useAgentChat(workId: string) {
	const [sessions, setSessions] = useState<ChatSession[]>()
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [chapterTitles, setChapterTitles] = useState<Record<string, string>>({})
	const [chapterOrder, setChapterOrder] = useState<Record<string, number>>({})
	const [entryNames, setEntryNames] = useState<Record<string, string>>({})
	const [volumeTitles, setVolumeTitles] = useState<Record<string, string>>({})
	const [assetInfo, setAssetInfo] = useState<AssetLabelInfo>({})
	const [error, setError] = useState('')
	const [stopped, setStopped] = useState<ReadonlySet<string>>(new Set())
	const active = useRef<string | null>(null)

	const fail = useCallback((message: string) => () => setError(message), [])
	const open = useCallback(
		async (sessionId: string, headId?: string) => {
			active.current = sessionId
			const next = await call('chat.get', {
				workId,
				sessionId,
				...(headId ? { headId } : {}),
			})
			if (active.current === sessionId) setSnapshot(next)
			return next
		},
		[workId],
	)
	const load = useCallback(async () => {
		const { sessions } = await call('chat.list', { workId })
		setSessions(sessions)
		const current =
			sessions.find((session) => session.sessionId === active.current) ??
			sessions[0]
		if (current) await open(current.sessionId)
		else {
			active.current = null
			setSnapshot(null)
		}
	}, [workId, open])

	useEffect(() => {
		active.current = null
		setSnapshot(null)
		setError('')
		void load().catch(fail(t('无法读取会话')))
		void call('production.get', { workId }).then(
			(production) => {
				setChapterTitles(production.chapterTitles ?? {})
				setChapterOrder(
					Object.fromEntries(
						(production.chapters ?? []).map((chapter, index) => [
							chapter.chapterId,
							index + 1,
						]),
					),
				)
			},
			() => {
				setChapterTitles({})
				setChapterOrder({})
			},
		)
		void call('library.list', {})
			.then(({ works }) => {
				setVolumeTitles(
					Object.fromEntries(
						works.flatMap((work) =>
							work.project
								? [[work.project.volumeId, work.project.volumeTitle]]
								: [],
						),
					),
				)
				const volumeId = works.find((work) => work.workId === workId)?.project
					?.volumeId
				if (!volumeId) throw new Error('no volume')
				return call('bible.get', { workId, volumeId })
			})
			.then(
				(bible) => {
					setEntryNames(collectEntryNames(bible))
					setAssetInfo(assetLabelInfoFromBible(bible))
				},
				() => {
					setEntryNames({})
					setAssetInfo({})
				},
			)
		const offEvent = window.novelive.on('event', (envelope: EventEnvelope) => {
			if (envelope.event.type !== 'chat.message') return
			const payload = envelope.event.payload as MessageEvent
			if (payload.workId !== workId) return
			if (payload.status === 'cancelled')
				setStopped((ids) => new Set(ids).add(payload.message.id))
			if (payload.sessionId === active.current)
				setSnapshot((current) =>
					current ? mergeMessage(current, payload) : current,
				)
		})
		const offReady = window.novelive.on('creator.ready', () => {
			void load().catch(fail(t('无法读取会话')))
		})
		return () => {
			offEvent()
			offReady()
		}
	}, [workId, load, fail])

	const latest = useRef(snapshot)
	latest.current = snapshot
	const creating = useRef<Promise<Snapshot> | null>(null)

	const create = useCallback(async () => {
		const created = await call('chat.create', { workId })
		active.current = created.session.sessionId
		latest.current = created
		setSnapshot(created)
		setSessions((list) => [created.session, ...(list ?? [])])
		return created
	}, [workId])

	const ensure = useCallback(async () => {
		if (latest.current) return latest.current
		creating.current ??= create().finally(() => {
			creating.current = null
		})
		return creating.current
	}, [create])

	return {
		sessions: sessions ?? [],
		loaded: sessions !== undefined,
		snapshot,
		chapterTitles,
		chapterOrder,
		entryNames,
		volumeTitles,
		assetInfo,
		stopped,
		error,
		setError,
		open: (sessionId: string, headId?: string) =>
			open(sessionId, headId).catch(fail(t('无法打开会话'))),
		create: () => create().catch(fail(t('无法新建会话'))),
		async rename(sessionId: string, title: string) {
			const renamed = await call('chat.rename', { workId, sessionId, title })
			setSessions((list) =>
				list?.map((session) =>
					session.sessionId === sessionId ? renamed : session,
				),
			)
			if (snapshot?.session.sessionId === sessionId)
				setSnapshot({ ...snapshot, session: renamed })
		},
		async remove(sessionId: string) {
			await call('chat.delete', { workId, sessionId })
			if (active.current === sessionId) active.current = null
			await load()
		},
		async attach(file: File) {
			const { session } = await ensure()
			const bytes = new Uint8Array(await file.arrayBuffer())
			let binary = ''
			for (const byte of bytes) binary += String.fromCharCode(byte)
			return call('chat.attach', {
				workId,
				sessionId: session.sessionId,
				name: file.name || t('粘贴的图片'),
				mimeType: file.type as Attachment['mimeType'],
				base64: btoa(binary),
			})
		},
		async send(
			text: string,
			attachmentIds: string[],
			parentId: string | null,
			position?: Position,
		) {
			const current = await ensure()
			const { sessionId } = current.session
			const { headId } = await call('chat.send', {
				workId,
				sessionId,
				expectedHeadId: current.headId,
				parentId,
				content: text
					? { text, attachmentIds }
					: { text: '', attachmentIds: attachmentIds as [string] },
				...(position ? { position } : {}),
			})
			active.current = sessionId
			let next: Snapshot
			try {
				next = await call('chat.get', { workId, sessionId, headId })
			} catch {
				setError(t('消息已发出，但无法刷新会话，请重试'))
				return
			}
			if (active.current === sessionId)
				setSnapshot((latest) => settle(latest, next, headId))
			setSessions((list) =>
				list?.map((session) =>
					session.sessionId === sessionId ? next.session : session,
				),
			)
		},
		async stop() {
			if (!snapshot?.headId) return
			await call('chat.stop', {
				workId,
				sessionId: snapshot.session.sessionId,
				headId: snapshot.headId,
			})
		},
		resolve(
			proposalId: string,
			decision: CommandInput<'proposal.resolve'>['decision'],
		) {
			return call('proposal.resolve', { workId, proposalId, decision })
		},
	}
}
