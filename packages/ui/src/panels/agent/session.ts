import type {
	CommandInput,
	CommandOutput,
	EventEnvelope,
} from '@novelive/creator/contract'
import { useCallback, useEffect, useRef, useState } from 'react'

export type Snapshot = CommandOutput<'chat.get'>
export type ChatSession = Snapshot['session']
export type Entry = Snapshot['entries'][number]
export type Message = Extract<Entry, { kind: 'message' }>
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
		void load().catch(fail('无法读取会话'))
		void call('production.get', { workId }).then(
			(production) => setChapterTitles(production.chapterTitles ?? {}),
			() => setChapterTitles({}),
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
			void load().catch(fail('无法读取会话'))
		})
		return () => {
			offEvent()
			offReady()
		}
	}, [workId, load, fail])

	const create = useCallback(async () => {
		const created = await call('chat.create', { workId })
		active.current = created.session.sessionId
		setSnapshot(created)
		setSessions((list) => [created.session, ...(list ?? [])])
		return created
	}, [workId])

	const ensure = useCallback(
		async () => snapshot ?? (await create()),
		[snapshot, create],
	)

	return {
		sessions: sessions ?? [],
		loaded: sessions !== undefined,
		snapshot,
		chapterTitles,
		stopped,
		error,
		setError,
		open: (sessionId: string, headId?: string) =>
			open(sessionId, headId).catch(fail('无法打开会话')),
		create: () => create().catch(fail('无法新建会话')),
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
				name: file.name || '粘贴的图片',
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
			const next = await call('chat.get', { workId, sessionId, headId })
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
