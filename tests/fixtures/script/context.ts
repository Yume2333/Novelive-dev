import type { AssetRegistry } from '../../../packages/format/src/model'

const entry = (
	id: string,
	type: AssetRegistry['entries'][number]['type'],
	aliases: string[] = [],
): AssetRegistry['entries'][number] => ({
	id,
	type,
	aliases,
	path: `assets/${id}.webp`,
	status: 'pending',
})

export const context = {
	paragraphIds: ['p0001', 'p0002'],
	speakers: ['traveler'],
	customMarks: ['wave'],
	assets: [
		entry('room/dusk', 'location'),
		entry('room/night', 'variant'),
		entry('cg-window', 'cg'),
		entry('traveler/coat/calm', 'expression'),
		entry('traveler/coat/smile', 'expression', ['traveler/coat/sly']),
		entry('traveler/cloak', 'character'),
		entry('traveler/cloak/calm', 'expression'),
	],
}
