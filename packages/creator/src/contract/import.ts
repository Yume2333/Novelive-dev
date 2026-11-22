import {
	arr,
	bool,
	int,
	lit,
	obj,
	oneOf,
	opt,
	str,
	union,
} from '@earendil-works/pi-schema'
import { workId } from '@novelive/format/model'
import { encodings } from '../import/txt/encoding'

const text = str({ minLength: 1 })
const encoding = oneOf(encodings)
const start = int({ minimum: 0 })

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
