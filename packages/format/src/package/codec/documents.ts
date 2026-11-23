import { compile, type Schema } from '@earendil-works/pi-schema'
import {
	assetRegistrySchema,
	chapterPreviewSchema,
	chapterSchema,
	characterFileSchema,
	foreshadowingFileSchema,
	glossarySchema,
	importReportSchema,
	locationFileSchema,
	relationsFileSchema,
	seriesSchema,
	styleFileSchema,
	timelineFileSchema,
	volumeDigestSchema,
	volumeSchema,
	volumeSkeletonSchema,
	workSchema,
} from '../../model'
import type { PackageJson } from '../contract'
import { corrupt } from './error'

export const maxJsonBytes = 32 * 1024 * 1024
const utf8 = new TextDecoder('utf-8', { fatal: true })

export function parseJson(path: string, bytes: Buffer): unknown {
	if (bytes.length > maxJsonBytes)
		throw corrupt(path, 'JSON document too large')
	try {
		return JSON.parse(utf8.decode(bytes))
	} catch (cause) {
		throw corrupt(path, 'invalid UTF-8 JSON', cause)
	}
}

export function validateDocument<T>(
	path: string,
	schema: Schema<T>,
	document: unknown,
): T {
	if (!compile(schema).check(document)) throw corrupt(path, 'invalid document')
	return document
}

const schemas = new Map(
	Object.entries({
		'series.json': seriesSchema,
		'volume.json': volumeSchema,
		'work.json': workSchema,
		'chapters/chapter.json': chapterSchema,
		'glossary.json': glossarySchema,
		'assets/asset-registry.json': assetRegistrySchema,
		'bible/relations.json': relationsFileSchema,
		'bible/timeline.json': timelineFileSchema,
		'bible/foreshadowing.json': foreshadowingFileSchema,
		'bible/style.json': styleFileSchema,
		'bible/digest.json': volumeDigestSchema,
		'bible/skeleton.json': volumeSkeletonSchema,
		'source/import-report.json': importReportSchema,
	}).map(([path, schema]) => [path, compile(schema as Schema<unknown>).check]),
)
const preview = compile(chapterPreviewSchema).check
const character = compile(characterFileSchema).check
const location = compile(locationFileSchema).check

export function isWorkDocument(path: string) {
	return /^volumes\/[^/]+\/works\/[^/]+\/work\.json$/.test(path)
}

function relativeDocumentPath(path: string) {
	return path
		.replace(/^volumes\/[^/]+\/(?:works\/[^/]+\/)?/, '')
		.replace(/^chapters\/[^/]+\//, 'chapters/')
}

export function isFixedPackageDocument(path: string) {
	return schemas.has(relativeDocumentPath(path))
}

export function checkPackageDocument(path: string, document: PackageJson) {
	const relative = relativeDocumentPath(path)
	const check =
		schemas.get(relative) ??
		(/^source\/preview\/[^/]+\.json$/.test(relative)
			? preview
			: /^bible\/characters\/[^/]+\.json$/.test(relative)
				? character
				: /^bible\/locations\/[^/]+\.json$/.test(relative)
					? location
					: undefined)
	if (check && !check(document)) throw corrupt(path, 'invalid document')
}
