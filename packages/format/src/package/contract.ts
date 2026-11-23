import { compile, int, obj, type Static } from '@earendil-works/pi-schema'
import { entityId, formatVersion, sceneId, workId } from '../model/metadata'

export const packageExtension = '.novelive'
export const packageFormatVersion = formatVersion
export const packageReaderVersion = 1
export const packageMimetype = {
	path: 'mimetype',
	index: 0,
	content: 'application/vnd.novelive+zip',
	compression: 'store',
} as const

export const releasedVersion = int({
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
})
export const packageWorkIdentity = obj({ workId, version: releasedVersion })
export type PackageWorkIdentity = Static<typeof packageWorkIdentity>

export function packageUpdate(
	incoming: PackageWorkIdentity,
	installed: PackageWorkIdentity | null,
): 'new' | 'update' | 'current' | 'older' {
	if (!installed || incoming.workId !== installed.workId) return 'new'
	if (incoming.version > installed.version) return 'update'
	return incoming.version === installed.version ? 'current' : 'older'
}

const validEntity = compile(entityId).check
const validWork = compile(workId).check
const validScene = compile(sceneId).check

export function forkWorkIdentity(
	source: PackageWorkIdentity,
	newWorkId: string,
) {
	if (!validWork(newWorkId) || newWorkId === source.workId)
		throw new Error('Importing as a project requires a new work UUID')
	return { workId: newWorkId, version: 0, derivedFrom: { ...source } }
}

export function nextExportVersion(version: number): number {
	if (
		!Number.isSafeInteger(version) ||
		version < 0 ||
		version === Number.MAX_SAFE_INTEGER
	)
		throw new RangeError('Work release version is out of range')
	return version + 1
}

const validVersion = compile(releasedVersion).check

export function packageVersionStatus(
	format: unknown,
	minReader?: unknown,
):
	| 'current'
	| 'migrate'
	| 'invalid_version'
	| 'unsupported_format'
	| 'unsupported_reader' {
	if (!validVersion(format)) return 'invalid_version'
	if (format > packageFormatVersion) return 'unsupported_format'
	if (minReader !== undefined) {
		if (!validVersion(minReader)) return 'invalid_version'
		if (minReader > packageReaderVersion) return 'unsupported_reader'
	}
	return format < packageFormatVersion ? 'migrate' : 'current'
}

export type PackageJson = Readonly<Record<string, unknown>> & {
	readonly formatVersion: number
}
export type PackageJsonMigration = {
	readonly from: number
	readonly to: number
	migrate(path: string, document: PackageJson): PackageJson
}

export type PackageEntry = {
	kind: 'mimetype' | 'content' | 'source'
	compression: 'store' | 'deflate'
}

function scopedContent(parts: string[]) {
	if (parts.length === 1)
		return parts[0] === 'glossary.json' || parts[0] === 'styles.css'
	const [folder, ...file] = parts
	const relative = file.join('/')
	if (folder === 'bible') return relative.endsWith('.json')
	if (folder !== 'assets') return false
	return (
		relative === 'asset-registry.json' ||
		relative.endsWith('.webp') ||
		(file[0] === 'fonts' && file.length === 2 && relative.endsWith('.woff2'))
	)
}

function projectContent(parts: string[]) {
	const [folder, volumeId, workFolder, workId, chapterFolder, chapterId, leaf] =
		parts
	if (folder !== 'volumes')
		return (
			(parts.length === 1 && folder === 'series.json') || scopedContent(parts)
		)
	if (!validEntity(volumeId)) return false
	if (workFolder !== 'works')
		return (
			(parts.length === 3 && workFolder === 'volume.json') ||
			scopedContent(parts.slice(2))
		)
	if (!validWork(workId)) return false
	if (chapterFolder !== 'chapters')
		return (
			(parts.length === 5 && chapterFolder === 'work.json') ||
			scopedContent(parts.slice(4))
		)
	return (
		parts.length === 7 &&
		validEntity(chapterId) &&
		(leaf === 'chapter.json' ||
			(leaf.endsWith('.nvs') && validScene(leaf.slice(0, -4))))
	)
}

function sourceContent(parts: string[]) {
	const [folder, file, original] = parts
	const originalFile = /^original\.(?:txt|epub|md|docx|pdf)$/
	const imageFile = /\.(?:png|jpe?g|webp|gif|bmp|avif|tiff?|svg)$/i
	if (parts.length === 1)
		return folder === 'import-report.json' || originalFile.test(folder)
	if (parts.length === 2) {
		if (folder === 'chapters') return file.endsWith('.txt')
		if (folder === 'preview') return file.endsWith('.json')
		return (
			(folder === 'images' || folder === 'references') && imageFile.test(file)
		)
	}
	return (
		parts.length === 3 &&
		folder === 'imports' &&
		(file === 'illustrations'
			? imageFile.test(original)
			: validEntity(file) && originalFile.test(original))
	)
}

export function packageEntry(path: string): PackageEntry | undefined {
	const parts = path.split('/')
	if (
		/[\\:]/.test(path) ||
		Array.from(path).some(
			(character) => character < ' ' || character === '\u007f',
		) ||
		parts.some(
			(part) => !part || part === '.' || part === '..' || /[ .]$/.test(part),
		)
	)
		return
	if (path === packageMimetype.path)
		return { kind: 'mimetype', compression: packageMimetype.compression }
	const isSource = parts[0] === 'source'
	if (!(isSource ? sourceContent(parts.slice(1)) : projectContent(parts)))
		return
	return {
		kind: isSource ? 'source' : 'content',
		compression: path.endsWith('.webp') ? 'store' : 'deflate',
	}
}

export function includePackageEntry(
	path: string,
	includeSource = false,
): boolean {
	const entry = packageEntry(path)
	return !!entry && (entry.kind !== 'source' || includeSource)
}
