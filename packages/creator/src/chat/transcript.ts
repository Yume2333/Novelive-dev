import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import type { Proposal } from '../contract'
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
	const compressed = summary
		? summaryContext(
				store,
				summary.data.summary,
				summary.data.pendingProposalIds ?? [],
				summary.at,
			)
		: { prefix: [], pendingProposalIds: [] }
	const groups = await Promise.all(
		path.slice(start).map(async (row) => {
			const turn: { messages: Message[]; pendingProposalIds: string[] } =
				row.data.role === 'user'
					? {
							messages: [
								await userMessage(attachments, row.data.parts, row.at),
							],
							pendingProposalIds: [],
						}
					: resolvedTurn(store, row.data.turn ?? [], row.data.parts)
			return {
				id: row.id,
				role: row.data.role,
				...turn,
			}
		}),
	)
	return {
		...compressed,
		groups,
	}
}

function summaryContext(
	store: ChatStore,
	summary: string,
	ids: string[],
	at: number,
) {
	const cards = ids.map((id) => store.proposal(id).proposal)
	const updates = cards
		.filter(({ status }) => status !== 'pending')
		.map(
			(card) => `Updated proposal (${card.prompt}): ${proposalOutcome(card)}`,
		)
	return {
		prefix: [summaryMessage([summary, ...updates].join('\n'), at)],
		pendingProposalIds: cards
			.filter(({ status }) => status === 'pending')
			.map(({ id }) => id),
	}
}

function proposalOutcome(proposal: Proposal) {
	if (proposal.status === 'pending')
		return 'Still awaiting the creator’s decision. No change has been applied.'
	if (proposal.status === 'rejected')
		return `The creator rejected the proposal. No change was applied.${proposal.feedback ? ` Reason: ${proposal.feedback}` : ''}`
	return proposal.payload.kind === 'rewriteScene'
		? 'The creator approved generating a rewrite for review. No changes have been applied to the scene.'
		: 'The creator approved the proposal and the requested action was initiated.'
}

function resolvedTurn(store: ChatStore, turn: Turn, parts: Part[]) {
	const pendingProposalIds: string[] = []
	const outcomes = new Map(
		parts.flatMap((part) => {
			if (part.type !== 'proposal') return []
			const { proposal, toolCallId } = store.proposal(part.proposal.id)
			if (proposal.status === 'pending') pendingProposalIds.push(proposal.id)
			if (!toolCallId) return []
			return [[toolCallId, proposalOutcome(proposal)] as const]
		}),
	)
	const messages = turn.map((message) => {
		if (
			message.role === 'assistant' &&
			(message.stopReason === 'error' || message.stopReason === 'aborted')
		) {
			const { errorMessage: _, ...partial } = message
			return {
				...partial,
				stopReason: 'stop' as const,
				content: [
					{ type: 'text' as const, text: '[Interrupted response]\n' },
					...partial.content,
				],
			}
		}
		if (message.role !== 'toolResult') return message
		const outcome = outcomes.get(message.toolCallId)
		return outcome ? { ...message, content: toolResult(outcome) } : message
	})
	return { messages, pendingProposalIds }
}

export async function compact(
	store: ChatStore,
	sessionId: string,
	{
		prefix,
		groups,
		pendingProposalIds,
	}: Awaited<ReturnType<typeof conversation>>,
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
	const pendingCards = [
		...pendingProposalIds,
		...older.flatMap((group) => group.pendingProposalIds),
	]
	store.compact(sessionId, anchor.id, summary, pendingCards)
	return [
		...summaryContext(store, summary, pendingCards, Date.now()).prefix,
		...groups.slice(lastUser).flatMap((group) => group.messages),
	]
}
