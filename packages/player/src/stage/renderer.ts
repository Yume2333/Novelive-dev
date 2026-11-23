import type { CompiledAction } from '@novelive/format/script'
import {
	Application,
	BlurFilter,
	ColorMatrixFilter,
	Container,
	Graphics,
	Particle,
	ParticleContainer,
	Sprite,
	Texture,
} from 'pixi.js'
import { AdjustmentFilter, GlitchFilter } from 'pixi-filters'
import type { StageState } from '../contract/stage'
import type { AssetWindow } from './assets'
import { slotX } from './state'

type Tween = {
	elapsed: number
	duration: number
	update: (progress: number) => void
	finish: () => void
}

function eased(progress: number, name: string) {
	if (name === 'linear') return progress
	if (name === 'ease-in') return progress * progress
	if (name === 'ease-out') return 1 - (1 - progress) ** 2
	return progress * progress * (3 - 2 * progress)
}

export class PixiStage {
	readonly app = new Application()
	private world = new Container()
	private pictures = new Container()
	private weather = new ParticleContainer({
		dynamicProperties: { position: true, rotation: true, color: true },
	})
	private masks = new Graphics()
	private tweens: Tween[] = []
	private particles: Particle[] = []
	private state: StageState | undefined
	private time = 0
	private observer: ResizeObserver | undefined

	async mount(host: HTMLElement) {
		await this.app.init({
			width: 960,
			height: 540,
			preference: 'webgl',
			backgroundAlpha: 0,
		})
		this.world.addChild(this.pictures, this.weather)
		this.app.stage.addChild(this.world, this.masks)
		host.append(this.app.canvas)
		this.observer = new ResizeObserver(() => {
			const { width, height } = host.getBoundingClientRect()
			const scale = Math.max(width / 960, height / 540)
			Object.assign(this.app.canvas.style, {
				position: 'absolute',
				width: `${960 * scale}px`,
				height: `${540 * scale}px`,
				left: `${(width - 960 * scale) / 2}px`,
				top: `${(height - 540 * scale) / 2}px`,
				objectFit: 'fill',
			})
		})
		this.observer.observe(host)
		this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000))
	}

	private animate(
		duration: number,
		update: Tween['update'],
		finish = () => {},
	) {
		if (!duration) {
			update(1)
			finish()
			return
		}
		this.tweens.push({ elapsed: 0, duration, update, finish })
		update(0)
	}

	complete() {
		for (const tween of this.tweens) {
			tween.update(1)
			tween.finish()
		}
		this.tweens = []
	}

	commit(
		state: StageState,
		assets: AssetWindow,
		actions: readonly CompiledAction[] = [],
		instant = false,
	) {
		this.complete()
		const previous = this.state
		this.state = structuredClone(state)
		const old = this.pictures
		const pictures = new Container()
		this.world.addChildAt(pictures, 0)
		this.pictures = pictures
		const image = (id: string, layer: Container, portrait = false) => {
			const sprite = new Sprite(assets.get(id))
			sprite.anchor.set(0.5, portrait ? 1 : 0.5)
			const scale = portrait
				? Math.min(540 / sprite.texture.height, 960 / sprite.texture.width)
				: Math.max(960 / sprite.texture.width, 540 / sprite.texture.height)
			sprite.scale.set(scale)
			sprite.position.set(480, portrait ? 540 : 270)
			layer.addChild(sprite)
			return sprite
		}
		if (state.background) image(state.background.assetId, pictures)
		for (const [slot, item] of Object.entries(state.sprites).sort(
			(a, b) => a[1].layer - b[1].layer,
		)) {
			const sprite = image(item.assetId, pictures, true)
			sprite.position.set(item.transform.x, item.transform.y)
			sprite.scale.x *= item.transform.scaleX
			sprite.scale.y *= item.transform.scaleY
			sprite.rotation = item.transform.rotation
			const move = actions.find(
				(action) => action.name === 'move' && action.args.slot === slot,
			)
			if (move && previous?.sprites[slot as keyof typeof slotX] && !instant) {
				const from =
					previous.sprites[slot as keyof typeof slotX]?.transform.x ??
					item.transform.x
				this.animate(Number(move.args.duration), (p) => {
					sprite.x =
						from +
						(item.transform.x - from) * eased(p, String(move.args.easing))
				})
			}
		}
		if (state.cg) image(state.cg, pictures)
		if (state.foreground) image(state.foreground, pictures)
		const change = actions.find(
			(action) =>
				['bg', 'show', 'face', 'costume', 'hide'].includes(action.name) &&
				(action.name === 'face' ||
					action.name === 'costume' ||
					action.args.transition !== 'none'),
		)
		if (change && !instant && previous) {
			const duration = Number(change.args.duration)
			const transition = String(change.args.transition ?? 'fade')
			const clip = new Graphics()
			this.world.addChild(clip)
			if (transition.startsWith('wipe-') || transition === 'iris')
				pictures.mask = clip
			this.animate(
				duration,
				(p) => {
					if (transition.startsWith('wipe-')) {
						clip.clear()
						const horizontal =
							transition === 'wipe-left' || transition === 'wipe-right'
						const width = horizontal ? 960 * p : 960
						const height = horizontal ? 540 : 540 * p
						clip
							.rect(
								transition === 'wipe-left' ? 960 - width : 0,
								transition === 'wipe-up' ? 540 - height : 0,
								width,
								height,
							)
							.fill(0xffffff)
					} else if (transition === 'iris')
						clip
							.clear()
							.circle(480, 270, 551 * p)
							.fill(0xffffff)
					else if (transition === 'slide' || transition === 'push') {
						pictures.x = 960 * (1 - p)
						if (transition === 'push') old.x = -960 * p
					} else {
						pictures.alpha = transition === 'fade' ? Math.max(0, p * 2 - 1) : p
						if (transition === 'fade') old.alpha = Math.max(0, 1 - p * 2)
						if (transition === 'zoom') {
							pictures.scale.set(1.2 - 0.2 * p)
							pictures.position.set(-96 * (1 - p), -54 * (1 - p))
						}
					}
				},
				() => {
					pictures.mask = null
					clip.destroy()
					old.destroy({ children: true })
				},
			)
		} else old.destroy({ children: true })
		if (JSON.stringify(previous?.filter) !== JSON.stringify(state.filter))
			this.setFilter(state)
		if (JSON.stringify(previous?.particle) !== JSON.stringify(state.particle))
			this.setParticles(state)
		this.masks.clear()
		if (state.mask?.shape === 'letterbox') {
			const height = state.mask.strength * 100
			this.masks
				.rect(0, 0, 960, height)
				.rect(0, 540 - height, 960, height)
				.fill(0x000000)
		} else if (state.mask) {
			for (let i = 0; i < 24; i++) {
				const inset = i * 4
				this.masks.rect(inset, inset, 960 - inset * 2, 540 - inset * 2).stroke({
					width: 8,
					color: 0x000000,
					alpha: state.mask.strength * (1 - i / 24) * 0.2,
				})
			}
		}
		const zoom = state.camera.zoom
		const focus = zoom.target === 'stage' ? 480 : slotX[zoom.target]
		const scale =
			zoom.scale *
			(state.camera.motion === 'push-in'
				? 1.12
				: state.camera.motion === 'sway'
					? 1.03
					: 1)
		const from = this.world.scale.x
		const camera = actions.find(
			(action) => action.name === 'zoom' || action.name === 'camera',
		)
		this.animate(instant ? 0 : Number(camera?.args.duration ?? 0), (p) => {
			const current =
				from +
				(scale - from) * eased(p, String(camera?.args.easing ?? 'linear'))
			this.world.scale.set(current)
			this.world.position.set(focus * (1 - current), 270 * (1 - current))
		})
		const shake = actions.find((action) => action.name === 'shake')
		if (shake && !instant) {
			const baseX = this.world.x
			this.animate(
				Number(shake.args.duration),
				(p) => {
					this.world.x =
						baseX +
						Math.sin(p * 90) * Number(shake.args.strength) * 24 * (1 - p)
				},
				() => {
					this.world.x = baseX
				},
			)
		}
		return new Promise<void>((resolve) =>
			this.animate(
				instant
					? 0
					: Math.max(0, ...this.tweens.map((tween) => tween.duration)),
				() => {},
				resolve,
			),
		)
	}

	private setFilter(state: StageState) {
		for (const filter of this.world.filters ?? []) filter.destroy()
		const filter = state.filter
		if (!filter) {
			this.world.filters = []
			return
		}
		switch (filter.effect) {
			case 'blur':
				this.world.filters = [new BlurFilter({ strength: filter.value * 10 })]
				break
			case 'brightness':
				this.world.filters = [
					new AdjustmentFilter({ brightness: filter.value }),
				]
				break
			case 'glitch':
				this.world.filters = [new GlitchFilter({ offset: filter.value * 40 })]
				break
			case 'sepia': {
				const matrix = new ColorMatrixFilter()
				matrix.sepia(false)
				matrix.alpha = Math.min(1, filter.value)
				this.world.filters = [matrix]
				break
			}
		}
	}

	private setParticles(state: StageState) {
		this.weather.removeParticles()
		this.particles = []
		if (!state.particle) return
		for (let i = 0; i < Math.round(state.particle.intensity * 160); i++) {
			const particle = new Particle({
				texture: Texture.WHITE,
				x: (i * 173.3) % 960,
				y: (i * 97.7) % 540,
				scaleX: state.particle.effect === 'rain' ? 1 : 5,
				scaleY: state.particle.effect === 'rain' ? 18 : 5,
				tint: state.particle.effect === 'sakura' ? 0xffb7d5 : 0xffffff,
				alpha: 0.7,
			})
			this.particles.push(particle)
			this.weather.addParticle(particle)
		}
	}

	private tick(seconds: number) {
		this.time += seconds
		if (this.state?.camera.motion === 'sway')
			this.world.rotation = Math.sin(this.time * 1.5) * 0.008
		else this.world.rotation = 0
		for (const tween of [...this.tweens]) {
			tween.elapsed += seconds
			const p = Math.min(1, tween.elapsed / tween.duration)
			tween.update(p)
			if (p === 1) {
				tween.finish()
				this.tweens.splice(this.tweens.indexOf(tween), 1)
			}
		}
		const weather = this.state?.particle
		if (weather)
			for (const particle of this.particles) {
				const velocity =
					seconds * weather.speed * (weather.effect === 'rain' ? 500 : 70)
				particle.y =
					(particle.y +
						velocity * Math.cos((weather.angle * Math.PI) / 180) +
						540) %
					540
				particle.x =
					(particle.x +
						velocity * Math.sin((weather.angle * Math.PI) / 180) +
						960) %
					960
				if (weather.effect === 'sakura') particle.rotation += seconds
			}
	}

	destroy() {
		this.complete()
		this.observer?.disconnect()
		this.app.destroy({ removeView: true }, { children: true })
	}
}
