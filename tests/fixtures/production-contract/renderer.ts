import type { Novelive } from '../../../packages/creator/src/contract'
import { mountFixedScene } from '../../../packages/player/src'

const { novelive } = window as Window & { novelive: Novelive }
const stage = document.createElement('div')
stage.id = 'fixed-scene'
stage.style.cssText = 'position: fixed; top: 0; left: 0'
document.body.append(stage)
void mountFixedScene(
	stage,
	{ background: 'room/dusk', sprite: 'traveler/coat/calm' },
	{ resolveAsset: (id) => novelive.resourceUrl(`${id}.png`) },
).catch((error) => {
	stage.textContent = String(error)
})
