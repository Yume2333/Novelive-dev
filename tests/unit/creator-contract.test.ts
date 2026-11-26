import { describe, expect, test } from 'vitest'
import {
	clientFrame,
	creatorCommandError,
	creatorFrame,
	importErrorCodes,
	importFailure,
	issueKinds,
	productionChapterRecordEvent,
	projectErrorCodes,
} from '../../packages/creator/src/contract'
import { ImportFailureError } from '../../packages/creator/src/contract/errors'
import { TextModelError } from '../../packages/creator/src/models/text'
import { ContextLimitError } from '../../packages/creator/src/pipeline/writing/budget'
import {
	failureKind,
	ProductionTaskError,
} from '../../packages/creator/src/scheduler/chapter'
import { SpendBudgetError } from '../../packages/creator/src/usage/spend'

describe('creator transport schemas', () => {
	test('call and cancel carry the current generation and request identity', () => {
		const call = {
			type: 'call',
			generation: 1,
			requestId: 1,
			command: 'events.list',
			payload: {},
		}
		expect(clientFrame.check(call)).toBe(true)
		expect(clientFrame.check({ ...call, generation: 0 })).toBe(false)
		expect(
			clientFrame.check({ type: 'cancel', generation: 1, requestId: 1 }),
		).toBe(true)
		expect(clientFrame.check({ type: 'cancel', requestId: 1 })).toBe(false)
	})

	test('event envelopes require scope-local sequence identity', () => {
		const frame = {
			type: 'event',
			generation: 2,
			envelope: {
				seq: 1,
				scope: 'app',
				scopeId: 'app',
				at: '2026-11-22T00:00:00Z',
				event: { type: 'example', payload: {} },
			},
		}
		expect(creatorFrame.check(frame)).toBe(true)
		expect(
			creatorFrame.check({
				...frame,
				envelope: { ...frame.envelope, scope: 'global' },
			}),
		).toBe(false)
	})

	test('preserves a context limit error through creator message serialization', () => {
		const failure = new ContextLimitError('Scene repair')
		const frame = structuredClone({
			type: 'error',
			generation: 1,
			requestId: 1,
			error: creatorCommandError(failure),
		})
		expect(creatorFrame.check(frame)).toBe(true)
		expect(frame.error).toEqual({
			code: 'context_limit',
			message: failure.message,
		})
	})

	test('preserves every import and project error code across the command boundary', () => {
		// import.target 等命令抛出的 ImportFailureError 必须原样穿过
		// IPC 错误 schema，绝不能被压成 internal（否则 UI 只能显示通用文案）。
		for (const code of importErrorCodes) {
			const failure = creatorCommandError(
				new ImportFailureError(code, `detail for ${code}`),
			)
			expect(failure.code, code).toBe(code)
			expect(failure.message, code).toBe(`detail for ${code}`)
			expect(
				creatorFrame.check({
					type: 'error',
					generation: 1,
					requestId: 1,
					error: failure,
				}),
				code,
			).toBe(true)
		}
		for (const code of projectErrorCodes)
			expect(
				creatorCommandError({ code, message: 'raw detail' }).code,
				code,
			).toBe(code)
		// 未登记的码仍然压成 internal
		expect(creatorCommandError({ code: 'not-a-code', message: 'x' }).code).toBe(
			'internal',
		)
		expect(creatorCommandError(new Error('plain')).code).toBe('internal')
	})
})

describe('structured error kinds', () => {
	test('issueKinds covers every model error code and scheduler error type', () => {
		for (const code of [
			'network',
			'auth',
			'not_found',
			'moderation',
			'invalid_config',
			'reasoning_limit',
			'context_limit',
			'cancelled',
			'internal',
			'unknown',
			'budget_paused',
			'portrait_framing',
			'matting_unavailable',
			'placeholder',
		])
			expect(issueKinds).toContain(code)
	})

	test('failureKind classifies model and scheduler failures at the source', () => {
		const wrapped = (
			code: 'network' | 'moderation' | 'auth' | 'not_found' | 'invalid_config',
		) =>
			new ProductionTaskError(
				code === 'moderation' ? 'moderation' : 'transient',
				`[${code}] detail`,
				code,
			)
		expect(failureKind(new SpendBudgetError('超出工程预算'))).toBe(
			'budget_paused',
		)
		expect(
			failureKind(
				new ProductionTaskError('reasoning_limit', '[reasoning_limit] none'),
			),
		).toBe('reasoning_limit')
		expect(failureKind(wrapped('moderation'))).toBe('moderation')
		expect(failureKind(wrapped('network'))).toBe('network')
		expect(failureKind(wrapped('auth'))).toBe('auth')
		expect(failureKind(wrapped('not_found'))).toBe('not_found')
		expect(failureKind(wrapped('invalid_config'))).toBe('invalid_config')
		expect(failureKind(new ProductionTaskError('final', 'parse failure'))).toBe(
			'unknown',
		)
		expect(failureKind(new Error('plain'))).toBe('unknown')
	})

	test('bare model errors classify into their issue kinds on the real path', () => {
		// Production steps rethrow most TextModelErrors bare (only network and
		// moderation are wrapped into ProductionTaskError); every remaining model
		// error code must still reach its kind.
		for (const [code, kind] of [
			['auth', 'auth'],
			['not_found', 'not_found'],
			['invalid_config', 'invalid_config'],
			['cancelled', 'cancelled'],
			['internal', 'internal'],
			['network', 'network'],
			['moderation', 'moderation'],
			['reasoning_limit', 'reasoning_limit'],
			['context_limit', 'context_limit'],
		] as const)
			expect(failureKind(new TextModelError(code, `[${code}] detail`))).toBe(
				kind,
			)
		// The chapter overflowing the model context is its own kind.
		expect(failureKind(new ContextLimitError('Scene repair'))).toBe(
			'context_limit',
		)
	})

	test('chapter records carry errorKind and raw detail, not a localized message', () => {
		const payload = {
			workId: '12345678-0000-4000-8000-000000000001',
			chapterId: 'ch0001',
			step: 'write',
			status: 'failed',
			errorKind: 'network',
			detail: '[network] Model connection interrupted or unavailable',
		}
		expect(
			productionChapterRecordEvent.check({
				type: 'production.chapterRecord',
				payload,
			}),
		).toBe(true)
		expect(
			productionChapterRecordEvent.check({
				type: 'production.chapterRecord',
				payload: { ...payload, errorKind: 'not-a-kind' },
			}),
		).toBe(false)
		expect(
			productionChapterRecordEvent.check({
				type: 'production.chapterRecord',
				payload: { ...payload, message: '运行失败' },
			}),
		).toBe(false)
		expect(
			productionChapterRecordEvent.check({
				type: 'production.chapterRecord',
				payload: {
					workId: payload.workId,
					chapterId: 'ch0001',
					step: 'review',
					status: 'done',
				},
			}),
		).toBe(true)
	})

	test('importFailure classifies typed import errors into importErrorCodes', () => {
		for (const code of [
			'epub_doctype',
			'epub_limit_exceeded',
			'epub_no_text',
			'illustration_mismatch',
			'invalid_docx',
			'docx_doctype',
			'no_extractable_text',
			'invalid_pdf',
			'markdown_encoding',
			'no_body_text',
			'txt_encoding_unknown',
			'txt_decoding_failed',
			'project_not_empty',
			'invalid_layout',
			'unknown_encoding',
			'invalid_illustration_selection',
			'join_empty_sections',
		])
			expect(importErrorCodes).toContain(code)
		const failure = importFailure(
			'epub',
			new ImportFailureError('epub_doctype', 'EPUB DTD is not supported'),
		)
		expect(failure).toEqual({
			status: 'error',
			format: 'epub',
			code: 'epub_doctype',
			detail: 'EPUB DTD is not supported',
		})
		expect(importFailure('epub', new Error('zip corrupt')).code).toBe(
			'invalid_epub',
		)
		expect(importFailure('pdf', new Error('bad pdf')).code).toBe('invalid_pdf')
		expect(
			importFailure('docx', {
				code: 'invalid_xml',
				message: 'DOCX contains invalid XML',
			}).code,
		).toBe('invalid_xml')
	})
})
