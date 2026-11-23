import { compile } from '@earendil-works/pi-schema'
import { expect, test } from 'vitest'
import {
	chatMessageEvent,
	commands,
	creatorCommandError,
	proposalPayloadSchema,
} from '../../packages/creator/src/contract'

const workId = 'f947f6e9-b854-4b16-b322-6aad47eb5df8'
const chapterId = 'ch0001'
const sceneId = 'aabbccdd'
const expectedRevision = 'revision-1'
const target = { workId, chapterId, sceneId, expectedRevision }

test('a line edit is scoped to an editor opening and carries a stable line ID, old value and revision', () => {
	const edit = compile(commands['editor.editLine'].input)
	const valid = {
		...target,
		editorId: 'editor-1',
		edit: {
			kind: 'text',
			lineId: '012a',
			previous: ': 灯亮了。',
			next: ': <pause>灯亮了。',
		},
	}
	expect(edit.check(valid)).toBe(true)
	expect(edit.check({ ...valid, expectedRevision: '' })).toBe(false)
	expect(edit.check({ ...valid, editorId: undefined })).toBe(false)
	expect(
		edit.check({ ...valid, edit: { ...valid.edit, previous: undefined } }),
	).toBe(false)
	expect(
		edit.check({ ...valid, edit: { ...valid.edit, next: ': 一句\n: 两句' } }),
	).toBe(false)
	const undo = compile(commands['editor.undo'].input)
	expect(
		undo.check({ workId, chapterId, editorId: 'editor-1', expectedRevision }),
	).toBe(true)
	expect(undo.check({ workId, chapterId, expectedRevision })).toBe(false)
	expect(
		creatorCommandError({ code: 'stale_revision', message: '已改变' }).code,
	).toBe('stale_revision')
})

test('rule edits distinguish chapter and work scope without conflating adaptation requirements', () => {
	const save = compile(commands['editor.saveRules'].input)
	const input = { workId, expectedRevision, previous: ['保留灯火'], next: [] }
	expect(
		save.check({ ...input, target: { scope: 'chapter', chapterId } }),
	).toBe(true)
	expect(save.check({ ...input, target: { scope: 'chapter' } })).toBe(false)
	expect(save.check({ ...input, target: { scope: 'work' } })).toBe(true)
	expect(save.check({ ...input, target: { scope: 'work', chapterId } })).toBe(
		false,
	)
})

test('the editor and Agent share the rewrite request; approval and applying selected hunks are separate', () => {
	const proposal = compile(proposalPayloadSchema)
	const request = {
		...target,
		sourceIds: ['p0001'],
		instruction: '保留第一段的动作',
	}
	expect(compile(commands['editor.rewriteScene'].input).check(request)).toBe(
		true,
	)
	expect(proposal.check({ kind: 'rewriteScene', request })).toBe(true)
	expect(
		proposal.check({
			kind: 'rewriteScene',
			request: { ...request, expectedRevision: undefined },
		}),
	).toBe(false)
	expect(proposal.check({ kind: 'customMark', name: 'glow' })).toBe(false)
	const resolve = compile(commands['proposal.resolve'].input)
	expect(
		resolve.check({
			workId,
			proposalId: 'p1',
			decision: { kind: 'reject', reason: '不符合原文' },
		}),
	).toBe(true)
	const apply = compile(commands['editor.applyRewrite'].input)
	expect(apply.check({ ...target, proposalId: 'p1', hunkIds: ['h1'] })).toBe(
		true,
	)
	expect(apply.check({ ...target, proposalId: 'p1', hunkIds: [] })).toBe(false)
	expect(
		apply.check({ ...target, proposalId: 'p1', hunkIds: ['h1', 'h1'] }),
	).toBe(false)
})

test('session sends are parented and versioned; streaming events carry the full assistant message', () => {
	const send = compile(commands['chat.send'].input)
	const sessionId = 'session-1'
	const request = {
		workId,
		sessionId,
		expectedHeadId: 'old-head',
		parentId: null,
		content: { text: '', attachmentIds: ['image-1'] },
	}
	expect(send.check(request)).toBe(true)
	expect(send.check({ ...request, expectedHeadId: undefined })).toBe(false)
	expect(
		send.check({ ...request, content: { text: '', attachmentIds: [] } }),
	).toBe(false)
	const message = {
		id: 'assistant-1',
		parentId: 'user-1',
		at: '2026-11-23T00:00:00Z',
		kind: 'message',
		role: 'assistant',
		parts: [{ type: 'text', text: '保留灯火。' }],
	}
	const payload = { workId, sessionId, headId: message.id, status: 'streaming' }
	expect(
		chatMessageEvent.check({
			type: 'chat.message',
			payload: { ...payload, message },
		}),
	).toBe(true)
	expect(
		chatMessageEvent.check({
			type: 'chat.message',
			payload: { ...payload, delta: '灯火。' },
		}),
	).toBe(false)
})
