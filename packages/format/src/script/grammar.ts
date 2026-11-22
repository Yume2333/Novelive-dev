export const slots = ['left', 'center', 'right'] as const
const easings = [
	'linear',
	'ease',
	'ease-in',
	'ease-out',
	'ease-in-out',
] as const
const transitions = [
	'fade',
	'dissolve',
	'wipe-left',
	'wipe-right',
	'wipe-up',
	'wipe-down',
	'slide',
	'push',
	'iris',
	'zoom',
	'none',
] as const
export const namePattern = /^[a-z][a-z0-9_-]*$/
const assetPattern = /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*){1,2}$/
export const builtInMarks = [
	'em',
	'b',
	'dim',
	'whisper',
	'shout',
	'glitch',
	'hl',
] as const

export type Value = string | number
type Read = (token: string) => Value | undefined
type Parameter = { name: string; read: Read; default?: Value }
type Action = {
	required: readonly Parameter[]
	optional?: readonly Parameter[]
	flexible?: boolean
}
const option = (name: string, read: Read, fallback: Value): Parameter => ({
	name,
	read,
	default: fallback,
})
const arg = (name: string, read: Read): Parameter => ({ name, read })
const matching =
	(pattern: RegExp): Read =>
	(token) =>
		pattern.test(token) ? token : undefined
const choice =
	(values: readonly string[]): Read =>
	(token) =>
		values.includes(token) ? token : undefined
export const numeric =
	(minimum: number, maximum = Number.MAX_VALUE): Read =>
	(token) => {
		if (!/^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(token)) return undefined
		const value = Number(token)
		return Number.isFinite(value) && value >= minimum && value <= maximum
			? value
			: undefined
	}
const seconds = numeric(0)
const ratio = numeric(0, 1)
const duration = (value: number) => option('duration', seconds, value)
const easing = (value: string) => option('easing', choice(easings), value)
const transition = (value: string) =>
	option('transition', choice(transitions), value)
const slot = choice(slots)
const id = matching(namePattern)
const asset = matching(assetPattern)
const typedAsset =
	(parts: number): Read =>
	(token) =>
		asset(token) && token.split('/').length === parts ? token : undefined
const sceneTarget = choice(['stage', ...slots])
const cg = matching(/^(?:cg-[a-z][a-z0-9_-]*|none)$/)

export const actions = {
	bg: {
		required: [arg('asset', typedAsset(2))],
		optional: [transition('fade'), duration(0.4)],
	},
	fg: { required: [arg('asset', (token) => asset(token) ?? cg(token))] },
	show: {
		required: [arg('asset', typedAsset(3)), arg('slot', slot)],
		optional: [transition('none'), duration(0.2)],
	},
	hide: {
		required: [arg('target', id)],
		optional: [transition('none'), duration(0.2)],
	},
	move: {
		required: [arg('slot', slot), arg('target', slot)],
		optional: [easing('ease-in-out'), duration(0.3)],
	},
	face: { required: [arg('asset', asset)], optional: [duration(0.2)] },
	costume: {
		required: [arg('asset', typedAsset(2))],
		optional: [duration(0.2)],
	},
	cg: { required: [arg('asset', cg)] },
	camera: {
		required: [arg('motion', choice(['sway', 'push-in', 'pull-out', 'reset']))],
		optional: [easing('ease-in-out'), duration(0.5)],
	},
	shake: {
		required: [],
		optional: [
			option(
				'strength',
				(token) => (token === 'strong' ? 1 : ratio(token)),
				0.35,
			),
			duration(0.3),
			easing('ease-out'),
		],
	},
	zoom: {
		required: [arg('scale', numeric(Number.MIN_VALUE))],
		optional: [
			option('target', sceneTarget, 'center'),
			duration(0.4),
			easing('ease-out'),
		],
		flexible: true,
	},
	particle: {
		required: [arg('effect', choice(['rain', 'snow', 'sakura', 'none']))],
		optional: [
			option('intensity', ratio, 0.5),
			option('speed', numeric(0), 1),
			option('angle', numeric(-360, 360), 0),
		],
	},
	mask: {
		required: [arg('shape', choice(['vignette', 'letterbox', 'none']))],
		optional: [option('strength', ratio, 0.5)],
	},
	filter: {
		required: [
			arg('effect', choice(['blur', 'brightness', 'sepia', 'glitch', 'none'])),
		],
		optional: [option('value', numeric(0), 0.5)],
	},
} satisfies Record<string, Action>

export type ActionName = keyof typeof actions
export const actionNames = Object.keys(actions) as [ActionName, ...ActionName[]]
export function actionSpec(name: ActionName): Action {
	return actions[name]
}
