import {
	arr,
	bool,
	int,
	lit,
	obj,
	oneOf,
	opt,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import { entityId, workId } from '@novelive/format/model'
import { encodings } from '../import/txt/encoding'

const text = str({ minLength: 1 })
const encoding = oneOf(encodings)
const start = int({ minimum: 0 })

export const workVolumeLinkSchema = obj({
	seriesId: entityId,
	volumeId: entityId,
	workId,
})
export type WorkVolumeLink = Static<typeof workVolumeLinkSchema>

// A join appends a new volume; the target never names an existing volume.
export const importJoinTargetSchema = obj({
	projectDir: text,
	seriesId: entityId,
})
export type ImportJoinTarget = Static<typeof importJoinTargetSchema>

const extractedBook = {
	metadata: obj({ title: opt(text), language: opt(text) }),
	volumes: arr(
		obj({
			title: text,
			chapters: arr(
				obj({
					title: text,
					paragraphs: arr(text, { minItems: 1 }),
					notes: arr(text),
				}),
				{ minItems: 1 },
			),
		}),
		{ minItems: 1 },
	),
}

export const extractedBookSchema = union([
	obj({
		...extractedBook,
		format: lit('epub'),
		navigation: oneOf(['nav', 'ncx', 'heading', 'spine']),
		illustrations: arr(
			obj({
				// ZIP entry key, not a URL or a destination on disk.
				archivePath: str({
					pattern:
						'^(?:(?!\\.{1,2}(?:/|$))[^/:\\\\\\x00-\\x1f]+/)*(?!\\.{1,2}$)[^/:\\\\\\x00-\\x1f]+$',
				}),
				// Zero-based volume/chapter indexes; if present, paragraph is the nearby body text.
				volume: start,
				chapter: start,
				paragraph: opt(start),
			}),
		),
	}),
	obj({ ...extractedBook, format: oneOf(['markdown', 'docx', 'pdf']) }),
])
export type ExtractedBook = Static<typeof extractedBookSchema>

export const importExtractionSchema = union([
	obj({ status: lit('ready'), book: extractedBookSchema }),
	obj({
		status: lit('unsupported'),
		format: lit('pdf'),
		reason: lit('no_extractable_text'),
	}),
])
export type ImportExtraction = Static<typeof importExtractionSchema>

export const importLayoutSchema = obj({
	title: text,
	language: text,
	confirmWithReferences: bool(),
	chapters: arr(obj({ title: text, start }), { minItems: 1 }),
	volumes: arr(obj({ title: text, start }), { minItems: 1 }),
})

export const importWizardSchema = obj({
	status: lit('ready'),
	projectDir: text,
	workId,
	encoding,
	paragraphs: start,
	layout: importLayoutSchema,
	suggested: importLayoutSchema,
	findings: arr(obj({ paragraph: start, note: str() })),
	references: arr(text),
})

export const importCommands = {
	'import.txt': {
		input: obj({
			sourcePath: text,
			folder: text,
			title: text,
			encoding: opt(encoding),
			references: arr(text, { maxItems: 3 }),
		}),
		output: union([
			obj({
				status: lit('encoding'),
				candidates: arr(obj({ encoding, preview: str() }), { minItems: 2 }),
			}),
			importWizardSchema,
		]),
	},
	'import.revise': {
		input: obj({ projectDir: text, layout: importLayoutSchema }),
		output: importWizardSchema,
	},
}
