import type { createRegistry } from '../registry'
import type { ChatService } from './index'

export function registerChat(
	registry: ReturnType<typeof createRegistry>,
	get: (workId: string) => ChatService | Promise<ChatService>,
) {
	registry.register('chat.list', async ({ workId }) =>
		(await get(workId)).list(),
	)
	registry.register('chat.create', async ({ workId, title }) =>
		(await get(workId)).create(title),
	)
	registry.register('chat.get', async ({ workId, sessionId, headId }) =>
		(await get(workId)).get(sessionId, headId),
	)
	registry.register('chat.rename', async ({ workId, sessionId, title }) =>
		(await get(workId)).rename(sessionId, title),
	)
	registry.register('chat.delete', async ({ workId, sessionId }) =>
		(await get(workId)).delete(sessionId),
	)
	registry.register('chat.attach', async (input, signal) =>
		(await get(input.workId)).attach(input, signal),
	)
	registry.register('chat.send', async (input, signal) =>
		(await get(input.workId)).send(input, signal),
	)
	registry.register('chat.stop', async ({ workId, sessionId, headId }) =>
		(await get(workId)).stop(sessionId, headId),
	)
	registry.register('proposal.get', async ({ workId, proposalId }) =>
		(await get(workId)).proposal(proposalId),
	)
	registry.register('proposal.resolve', async (input, signal) =>
		(await get(input.workId)).resolve(input, signal),
	)
}
