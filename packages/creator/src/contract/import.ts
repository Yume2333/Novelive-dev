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

const illustrationSchema = obj({
	archivePath: str({
		pattern:
			'^(?:(?!\\.{1,2}(?:/|$))[^/:\\\\\\x00-\\x1f]+/)*(?!\\.{1,2}$)[^/:\\\\\\x00-\\x1f]+$',
	}),
	volume: start,
	chapter: start,
	paragraph: opt(start),
})

export const extractedBookSchema = union([
	obj({
		...extractedBook,
		format: lit('epub'),
		navigation: oneOf(['nav', 'ncx', 'heading', 'spine']),
		illustrations: arr(illustrationSchema),
	}),
	obj({
		...extractedBook,
		format: lit('docx'),
		illustrations: arr(illustrationSchema),
	}),
	obj({ ...extractedBook, format: oneOf(['markdown', 'pdf']) }),
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
	format: oneOf(['txt', 'epub', 'markdown', 'docx', 'pdf']),
	workIds: arr(workId, { minItems: 1 }),
	projectDir: text,
	workId,
	encoding: opt(encoding),
	paragraphs: start,
	layout: importLayoutSchema,
	suggested: importLayoutSchema,
	findings: arr(obj({ paragraph: start, note: str() })),
	references: arr(text),
	illustrations: arr(
		obj({
			id: text,
			volume: start,
			chapter: start,
			paragraph: opt(start),
			preview: str({ pattern: '^data:image/png;base64,', maxLength: 350000 }),
		}),
		{ maxItems: 40 },
	),
	selectedIllustrations: arr(text, { maxItems: 3, uniqueItems: true }),
})

const importJoinedSchema = obj({
	status: lit('joined'),
	format: oneOf(['txt', 'epub', 'markdown', 'docx', 'pdf']),
	projectDir: text,
	seriesId: entityId,
	workId,
	workIds: arr(workId, { minItems: 1 }),
	volumes: arr(
		obj({
			volumeId: entityId,
			workId,
			title: text,
			chapters: int({ minimum: 1 }),
		}),
		{ minItems: 1 },
	),
})
export type ImportJoined = Static<typeof importJoinedSchema>

const fileImport = {
	input: obj({
		sourcePath: text,
		folder: text,
		title: text,
		encoding: opt(encoding),
		references: arr(text, { maxItems: 3 }),
		join: opt(importJoinTargetSchema),
	}),
	output: union([
		obj({
			status: lit('encoding'),
			candidates: arr(obj({ encoding, preview: str() }), { minItems: 2 }),
		}),
		importWizardSchema,
		importJoinedSchema,
		obj({
			status: lit('unsupported'),
			format: lit('pdf'),
			reason: lit('no_extractable_text'),
		}),
	]),
}

export const importCommands = {
	'import.target': {
		input: obj({ projectDir: text }),
		output: obj({ projectDir: text, seriesId: entityId, title: str() }),
	},
	'import.file': fileImport,
	'import.txt': fileImport,
	'import.revise': {
		input: obj({
			projectDir: text,
			layout: importLayoutSchema,
			selectedIllustrations: opt(arr(text, { maxItems: 3, uniqueItems: true })),
		}),
		output: importWizardSchema,
	},
}
