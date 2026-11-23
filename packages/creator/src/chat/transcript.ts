import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import type { ChatAttachments } from './attachments'
import { estimate, summaryMessage, toolResult } from './model'
import { type ChatStore, lineage, type Part, type Turn } from './store'

export function assistantParts(message: AssistantMessage): Part[] {
	return message.content.map((part): Part => {
		switch (part.type) {
			case 'text':
				return { type: 'text', text: part.text }
			case 'thinking':
				return { type: 'reasoning', text: part.thinking }
			case 'toolCall':
				return {
					type: 'tool',
					id: part.id,
					name: part.name,
					input: JSON.stringify(part.arguments ?? {}),
				}
		}
		throw new Error('未知的助手消息类型')
	})
}

export async function userMessage(
	attachments: ChatAttachments,
	parts: Part[],
	timestamp: number,
): Promise<Extract<Message, { role: 'user' }>> {
	const content = await Promise.all(
		parts.map(async (part) => {
			if (part.type === 'image') return attachments.image(part.attachment)
			if (part.type === 'text') return part
			throw new Error('无效的用户消息')
		}),
	)
	return { role: 'user', content, timestamp }
}

export async function conversation(
	store: ChatStore,
	attachments: ChatAttachments,
	sessionId: string,
	headId: string | null,
) {
	const rows = store.entries(sessionId)
	const path = lineage(rows, headId)
	const anchors = new Map(path.map(({ id }, index) => [id, index]))
	const summaries = rows.filter((row) => row.kind === 'compaction')
	const summary = summaries
		.reverse()
		.reduce<(typeof summaries)[number] | undefined>((best, row) => {
			const index = anchors.get(row.parentId ?? '')
			return index !== undefined &&
				(!best || index > (anchors.get(best.parentId ?? '') ?? -1))
				? row
				: best
		}, undefined)
	const start = summary ? (anchors.get(summary.parentId ?? '') ?? -1) + 1 : 0
	const groups = await Promise.all(
		path.slice(start).map(
			async (
				row,
			): Promise<{
				id: string
				role: 'user' | 'assistant'
				messages: Message[]
			}> => ({
				id: row.id,
				role: row.data.role,
				messages:
					row.data.role === 'user'
						? [await userMessage(attachments, row.data.parts, row.at)]
						: resolvedTurn(store, row.data.turn ?? [], row.data.parts),
			}),
		),
	)
	return {
		prefix: summary ? [summaryMessage(summary.data.summary, summary.at)] : [],
		groups,
	}
}

export function resolvedTurn(
	store: ChatStore,
	turn: Turn,
	parts: Part[],
): Turn {
	const outcomes = new Map(
		parts.flatMap((part) => {
			if (part.type !== 'proposal') return []
			const { proposal, toolCallId } = store.proposal(part.proposal.id)
			if (!toolCallId) return []
			const text =
				proposal.status === 'pending'
					? 'Still awaiting the creator’s decision. No change has been applied.'
					: proposal.status === 'approved'
						? proposal.payload.kind === 'rewriteScene'
							? 'The creator approved generating a rewrite for review. No changes have been applied to the scene.'
							: 'The creator approved the proposal and the requested action was initiated.'
						: `The creator rejected the proposal. No change was applied.${proposal.feedback ? ` Reason: ${proposal.feedback}` : ''}`
			return [[toolCallId, text] as const]
		}),
	)
	return turn.map((message) => {
		if (message.role !== 'toolResult') return message
		const outcome = outcomes.get(message.toolCallId)
		return outcome ? { ...message, content: toolResult(outcome) } : message
	})
}

export async function compact(
	store: ChatStore,
	sessionId: string,
	{ prefix, groups }: Awaited<ReturnType<typeof conversation>>,
	budget: number,
	next: Message | undefined,
	summarize: (messages: Message[]) => Promise<string>,
) {
	const messages = [...prefix, ...groups.flatMap((group) => group.messages)]
	if (
		messages.reduce(
			(total, message) => total + estimate(message),
			next ? estimate(next) : 0,
		) <= budget
	)
		return messages

	// Keep the most recent complete exchange and never split an assistant/tool pair.
	const lastUser = groups.findLastIndex((group) => group.role === 'user')
	const older = groups.slice(0, Math.max(lastUser, 0))
	const anchor = older.at(-1)
	if (!anchor) return messages
	const summary = await summarize([
		...prefix,
		...older.flatMap((group) => group.messages),
	])
	store.compact(sessionId, anchor.id, summary)
	return [
		summaryMessage(summary, Date.now()),
		...groups.slice(lastUser).flatMap((group) => group.messages),
	]
}
