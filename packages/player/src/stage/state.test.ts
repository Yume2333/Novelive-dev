import type { CompiledAction } from '@novelive/format/script'
import { describe, expect, it } from 'vitest'
import { direct, emptyStage, previewOpening, stageAssets } from './state'

const action = (
	name: CompiledAction['name'],
	args: CompiledAction['args'],
	assets: CompiledAction['assets'] = [],
): CompiledAction => ({ type: 'action', line: 1, col: 1, name, args, assets })

describe('stage direction state', () => {
	it('preserves ordinary playback when a move precedes a hard-cut character replacement', () => {
		const prior = direct(
			emptyStage(),
			action('show', { slot: 'center' }, [{ id: 'hero/coat/calm' }]),
		)
		const selected = [
			action('move', { slot: 'center', target: 'left', duration: 1 }),
			action('show', { slot: 'center', transition: 'none' }, [
				{ id: 'other/coat/calm' },
			]),
		]
		const opening = previewOpening(prior, selected)
		expect(opening).toEqual(prior)
		expect(selected.reduce(direct, opening)).toEqual(
			selected.reduce(direct, prior),
		)
		expect(selected.reduce(direct, opening).sprites.center?.transform.x).toBe(
			480,
		)
	})
	it.each(['left', 'center', 'right'] as const)(
		'keeps safe cuts and mixed portrait cues equivalent to ordinary playback in %s',
		(slot) => {
			const prior = direct(
				direct(
					emptyStage(),
					action('bg', { transition: 'none' }, [{ id: 'room/undrawn' }]),
				),
				action('show', { slot }, [{ id: 'hero/coat/calm' }]),
			)
			for (const selected of [
				[
					action('bg', { transition: 'none' }, [{ id: 'room/dusk' }]),
					action('move', { slot, target: 'left' }),
					action('show', { slot, transition: 'none' }, [
						{ id: 'other/coat/calm' },
					]),
				],
				[
					action('show', { slot, transition: 'none' }, [
						{ id: 'other/coat/calm' },
					]),
					action('move', { slot, target: 'left' }),
				],
				[
					action('hide', { target: slot, transition: 'none' }),
					action('show', { slot, transition: 'none' }, [
						{ id: 'hero/coat/calm' },
					]),
					action('move', { slot, target: 'left' }),
				],
			]) {
				const opening = previewOpening(prior, selected)
				expect(selected.reduce(direct, opening)).toEqual(
					selected.reduce(direct, prior),
				)
				if (selected[0].name === 'bg')
					expect(stageAssets(opening)).not.toContain('room/undrawn')
			}
		},
	)
	it('keeps preview movement and expression origins while omitting assets replaced by cuts', () => {
		const prior = direct(
			direct(
				emptyStage(),
				action('bg', { transition: 'none' }, [{ id: 'room/undrawn' }]),
			),
			action('show', { slot: 'center' }, [{ id: 'hero/coat/calm' }]),
		)
		const selected = [
			action('bg', { transition: 'none' }, [{ id: 'room/dusk' }]),
			action('face', { duration: 1 }, [{ id: 'hero/coat/smile' }]),
			action('move', { slot: 'center', target: 'left', duration: 1 }),
		]
		const opening = previewOpening(prior, selected)
		expect(stageAssets(opening)).toEqual(['room/dusk', 'hero/coat/calm'])
		expect(opening.sprites.center?.transform.x).toBe(480)
		expect(selected.reduce(direct, opening).sprites.center).toMatchObject({
			assetId: 'hero/coat/smile',
			transform: { x: 240 },
		})
		expect(prior.background?.assetId).toBe('room/undrawn')
	})
	it('keeps outgoing assets for animated preview transitions and supports empty openings', () => {
		const prior = direct(
			emptyStage(),
			action('bg', { transition: 'none' }, [{ id: 'room/dusk' }]),
		)
		expect(
			previewOpening(prior, [
				action('bg', { transition: 'fade' }, [{ id: 'room/night' }]),
			]),
		).toEqual(prior)
		expect(previewOpening(emptyStage(), [])).toEqual(emptyStage())
	})
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
