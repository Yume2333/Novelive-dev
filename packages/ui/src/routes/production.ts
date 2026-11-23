import { generatePath } from 'react-router-dom'

export const productionRoutes = {
	import: '/import',
	work: '/work/:id',
	editor: '/work/:id/edit',
	bible: '/work/:id/bible',
	play: '/work/:id/play',
	production: '/work/:id/production',
	confirmVisual: '/work/:id/confirm/visual',
	confirmFirst: '/work/:id/confirm/first',
} as const

export function workRoute(
	route: Exclude<keyof typeof productionRoutes, 'import'>,
	workId: string,
): string {
	return generatePath(productionRoutes[route], { id: workId })
}
