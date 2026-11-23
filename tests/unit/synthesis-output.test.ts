import { obj } from '@earendil-works/pi-schema'
import { expect, test } from 'vitest'
import { synthesisOutput } from '../../packages/creator/src/synthesis/output'
import {
	biblePatchSchema,
	glossaryPatchSchema,
} from '../../packages/format/src/model'

test('fills missing empty collections in the redacted 24-character whole-volume repair', () => {
	const contract = synthesisOutput(
		obj({
			biblePatch: biblePatchSchema,
			glossaryPatch: glossaryPatchSchema,
		}),
	)
	const characters = Array.from({ length: 24 }, (_, i) => ({
		kind: 'character',
		op: 'add',
		entry: {
			id: `character-${i}`,
			name: `Character ${i}`,
			status: 'candidate',
		},
	}))
	expect(contract.instructions).toContain('aliases?:[s]')
	expect(contract.parse({ biblePatch: structuredClone(characters) })).toEqual({
		ok: true,
		value: {
			biblePatch: characters.map(({ entry, ...item }) => ({
				...item,
				entry: { ...entry, aliases: [] },
			})),
			glossaryPatch: [],
		},
	})
	expect(contract.parse({})).toEqual({
		ok: true,
		value: { biblePatch: [], glossaryPatch: [] },
	})
	const [first] = characters
	expect(
		contract.parse({
			biblePatch: [
				{ ...first, entry: { ...first.entry, name: undefined, aliases: null } },
			],
		}),
	).toMatchObject({
		ok: false,
		errors: expect.arrayContaining([
			expect.objectContaining({ path: '/biblePatch/0/entry/name' }),
			expect.objectContaining({ path: '/biblePatch/0/entry/aliases' }),
		]),
	})
})
