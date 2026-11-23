import { realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { BiblePatch, Style } from '@novelive/format/model'
import sharp from 'sharp'
import { isProjectRelativePath, type Project } from '../project'

async function invalidImageReason(root: string, path: string) {
	if (!isProjectRelativePath(path)) return 'not a project-relative path'
	let resolved: string
	try {
		resolved = await realpath(join(root, path))
		if (!isProjectRelativePath(relative(root, resolved).split(sep).join('/')))
			return 'not a project-relative path'
		if (!(await stat(resolved)).isFile()) return 'not a project file'
	} catch (error) {
		if (error instanceof Error && 'code' in error) {
			if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
				return 'not an existing project file'
			return 'not a readable project file'
		}
		throw error
	}
	try {
		await sharp(resolved).metadata()
	} catch {
		return 'not a readable image'
	}
}

export async function validateStyleReferences(
	project: Project,
	style: Style,
): Promise<Style> {
	if (!style.references?.length) return style
	const root = await realpath(project.root)
	const references = []
	for (const [index, reference] of style.references.entries()) {
		const reason = await invalidImageReason(root, reference.path)
		if (reason)
			console.warn('Dropped invalid style image reference', { index, reason })
		else references.push(reference)
	}
	if (references.length === style.references.length) return style
	const { references: _, ...entry } = style
	return references.length ? { ...entry, references } : entry
}

export function validateStylePatch(project: Project, patch: BiblePatch) {
	return Promise.all(
		patch.map(async (item) =>
			item.kind === 'style'
				? { ...item, entry: await validateStyleReferences(project, item.entry) }
				: item,
		),
	)
}
