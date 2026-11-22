import type { Novelive } from '../../../packages/creator/src/contract'
import { mountFixedScene } from '../../../packages/player/src'

const { novelive } = window as Window & { novelive: Novelive }
const stage = document.querySelector('main')
if (!stage) throw new Error('Missing fixed scene mount point')
void mountFixedScene(
	stage,
	{ background: 'room/dusk', sprite: 'traveler/coat/calm' },
	{ resolveAsset: (id) => novelive.resourceUrl(`${id}.png`) },
).catch((error) => {
	stage.textContent = String(error)
})
