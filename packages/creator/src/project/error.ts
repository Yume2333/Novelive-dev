import type { ProjectErrorCode } from '../contract/project'

export class ProjectError extends Error {
	constructor(
		readonly code: ProjectErrorCode,
		readonly path: string,
		detail: string,
		options?: ErrorOptions,
	) {
		super(`${path}: ${detail}`, options)
		this.name = 'ProjectError'
	}
}
