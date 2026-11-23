import {
	arr,
	bool,
	compile,
	lit,
	obj,
	oneOf,
	type Static,
	str,
	union,
} from '@earendil-works/pi-schema'
import { entityId, workId } from '@novelive/format/model'
import { packageWorkIdentity, releasedVersion } from '@novelive/format/package'

export type {
	LegacySaveGroup,
	ProgressMigrationInput,
	ProgressMigrationResult,
} from '../../../player/src/contract'

const path = str({ minLength: 1, pattern: '^[^\\u0000]+$' })
const title = str({ minLength: 1 })
const scope = union([
	obj({ level: lit('series') }),
	obj({ level: lit('volume'), volumeId: entityId }),
	obj({ level: lit('work'), volumeId: entityId, workId }),
])
const exportSelection = { projectRoot: path, scope, includeSource: bool() }
const workUpdate = obj({
	workId,
	installedVersion: releasedVersion,
	incomingVersion: releasedVersion,
})
const importWorks = arr(
	union([
		obj({ relation: lit('new'), work: packageWorkIdentity, title }),
		obj({
			relation: oneOf(['update', 'current', 'older']),
			work: packageWorkIdentity,
			title,
			installedVersion: releasedVersion,
		}),
	]),
	{ minItems: 1 },
)
const chapterWarning = obj({ workId, chapterId: entityId, title })
const error = obj({
	code: oneOf([
		'corrupt_package',
		'unsupported_format',
		'unsupported_reader',
		'write_failed',
		'stale_import',
		'invalid_selection',
		'internal',
	]),
	message: title,
})

const previewExport = obj({
	operation: lit('previewExport'),
	...exportSelection,
})
const exportPackage = obj({
	operation: lit('export'),
	...exportSelection,
	destination: path,
})
const inspectImport = obj({
	operation: lit('inspectImport'),
	packagePath: path,
})
const importPackage = obj({
	operation: lit('import'),
	packagePath: path,
	approvedUpdates: arr(workUpdate, { uniqueItems: true }),
})
const importAsProject = obj({
	operation: lit('importAsProject'),
	packagePath: path,
	destination: path,
})
const requests = union([
	previewExport,
	exportPackage,
	inspectImport,
	importPackage,
	importAsProject,
])
export const shareRequest = compile(requests)
export type ShareRequest = Static<typeof requests>

const previewed = obj({
	operation: lit('previewExport'),
	warnings: arr(chapterWarning),
})
const exported = obj({
	operation: lit('export'),
	works: arr(packageWorkIdentity, { minItems: 1 }),
})
const inspected = obj({ operation: lit('inspectImport'), works: importWorks })
const imported = obj({
	operation: lit('import'),
	works: arr(packageWorkIdentity),
})
const projectImported = obj({
	operation: lit('importAsProject'),
	projectRoot: path,
	workIds: arr(workId, { minItems: 1, uniqueItems: true }),
})
const results = union([
	previewed,
	exported,
	inspected,
	imported,
	projectImported,
])
const responses = union([
	obj({ ok: lit(true), result: results }),
	obj({ ok: lit(false), error }),
])
const shareResponse = compile(responses)
export type ShareResponse = Static<typeof responses>

type ShareResponseFor<Operation extends ShareRequest['operation']> =
	| {
			ok: true
			result: Extract<Static<typeof results>, { operation: Operation }>
	  }
	| Extract<ShareResponse, { ok: false }>

export function checkShareResponse<Operation extends ShareRequest['operation']>(
	expectedOperation: Operation,
	input: unknown,
): input is ShareResponseFor<Operation> {
	return (
		shareResponse.check(input) &&
		(!input.ok || input.result.operation === expectedOperation)
	)
}

export interface DesktopShareApi {
	call<Request extends ShareRequest>(
		request: Request,
	): Promise<ShareResponseFor<Request['operation']>>
}
