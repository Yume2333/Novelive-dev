import { createRoot } from 'react-dom/client'
import { ProgressPanel } from '../../packages/ui/src/pages/player/controls/ProgressPanel'

const slot = { kind: 'manual', slot: 1 } as const
const savedAt = '2026-01-01T00:00:00.000Z'
const snapshot = {
	position: { chapterId: 'chapter', sceneId: 'scene', sentenceId: 'sentence' },
	stage: {
		background: null,
		sprites: {},
		cg: null,
		foreground: null,
		camera: {
			motion: 'reset',
			zoom: { scale: 1, target: 'stage' },
			shake: null,
		},
		particle: null,
		mask: null,
		filter: null,
		text: { kind: 'narration', content: [] },
	},
	active: [],
} as const
const save = { slot, savedAt, snapshot, thumbnailRef: 'fixture.webp' }
const fixture = document.createElement('div')
document.body.replaceChildren(fixture)
createRoot(fixture).render(
	<ProgressPanel
		view="load"
		workId="work"
		progress={{ mainline: null, read: [], saves: [save] }}
		history={{ entries: [], cursor: null }}
		onSave={async () => {}}
		onLoad={async () => {}}
		onSlot={() => {}}
		onHistory={() => {}}
		onHistoryStep={() => {}}
		legacySaves={{
			list: async () => [
				{ version: 1, saves: [save] },
				{ version: 2, saves: [save] },
			],
			remove: async (workId, version, slot) => {
				fixture.dataset.removed = JSON.stringify({ workId, version, slot })
			},
		}}
	/>,
)
