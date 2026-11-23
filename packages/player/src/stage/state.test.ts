import type { CompiledAction } from '@novelive/format/script'
import { describe, expect, it } from 'vitest'
import { direct, emptyStage, stageAssets } from './state'

const action = (
	name: CompiledAction['name'],
	args: CompiledAction['args'],
	assets: CompiledAction['assets'] = [],
): CompiledAction => ({ type: 'action', line: 1, col: 1, name, args, assets })

describe('stage direction state', () => {
	it('resets a replacement character to its requested slot after a move', () => {
		const moved = direct(
			direct(
				emptyStage(),
				action('show', { slot: 'center' }, [{ id: 'hero/coat/calm' }]),
			),
			action('move', { slot: 'center', target: 'left' }),
		)
		expect(
			direct(
				moved,
				action('show', { slot: 'center' }, [{ id: 'other/coat/calm' }]),
			).sprites.center?.transform.x,
		).toBe(480)
	})
	it('gives hide slot names precedence over character IDs', () => {
		const state = direct(
			emptyStage(),
			action('show', { slot: 'left' }, [
				{ id: 'right/coat/calm', slot: 'left' },
			]),
		)
		expect(direct(state, action('hide', { target: 'right' }))).toEqual(state)
		expect(direct(state, action('hide', { target: 'left' })).sprites).toEqual(
			{},
		)
	})
	it('keeps empty stages serializable and ignores missing relative targets', () => {
		expect(stageAssets(emptyStage())).toEqual([])
		expect(
			direct(emptyStage(), action('move', { slot: 'center', target: 'left' })),
		).toEqual(emptyStage())
	})
	it('preserves slot position, transforms and layer on expression and costume changes', () => {
		const shown = direct(
			emptyStage(),
			action('show', { slot: 'center' }, [
				{ id: 'hero/coat/calm', slot: 'center' },
			]),
		)
		const moved = direct(
			shown,
			action('move', { slot: 'center', target: 'left' }),
		)
		for (const name of ['show', 'face', 'costume'] as const) {
			const changed = direct(
				moved,
				action(name, { slot: 'center' }, [
					{ id: 'hero/coat/smile', slot: 'center' },
				]),
			)
			expect(changed.sprites.center).toEqual({
				...moved.sprites.center,
				assetId: 'hero/coat/smile',
			})
		}
		expect(shown.sprites.center?.transform.x).toBe(480)
		expect(direct(moved, action('hide', { target: 'hero' })).sprites).toEqual(
			{},
		)
	})
	it('applies intent directions idempotently without accumulating camera offsets', () => {
		let state = emptyStage()
		for (const cue of [
			action('bg', { transition: 'fade', duration: 0.4 }, [{ id: 'room/day' }]),
			action('zoom', { scale: 1.2, target: 'left' }),
			action('camera', { motion: 'push-in' }),
			action('particle', {
				effect: 'snow',
				intensity: 0.5,
				speed: 1,
				angle: 10,
			}),
			action('mask', { shape: 'letterbox', strength: 0.5 }),
			action('filter', { effect: 'blur', value: 0.5 }),
			action('cg', {}, [{ id: 'cg-test' }]),
			action('fg', {}, [{ id: 'room/day' }]),
		]) {
			state = direct(state, cue)
			expect(direct(state, cue)).toEqual(state)
		}
		for (const name of ['cg', 'fg', 'particle', 'mask', 'filter'] as const)
			state = direct(
				state,
				action(name, { asset: 'none', effect: 'none', shape: 'none' }),
			)
		expect(state).toMatchObject({
			cg: null,
			foreground: null,
			particle: null,
			mask: null,
			filter: null,
		})
	})
})
