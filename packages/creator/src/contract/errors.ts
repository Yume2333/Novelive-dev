/**
 * Machine-readable error kinds and codes the creator backend classifies at
 * the source. The UI maps every entry to a localized sentence; the raw
 * `detail` text only belongs inside a collapsed details disclosure.
 */

/** Every failure a production chapter or run record can report. */
export const issueKinds = [
	// Model error codes
	'network',
	'auth',
	'not_found',
	'moderation',
	'invalid_config',
	'reasoning_limit',
	'context_limit',
	'cancelled',
	'internal',
	// Unclassified model or pipeline failure (the default kind)
	'unknown',
	// Scheduler error types
	'budget_paused',
	'portrait_framing',
	'matting_unavailable',
	// Drawing fell back to placeholder art
	'placeholder',
] as const
export type IssueKind = (typeof issueKinds)[number]

/** Every import failure that reaches the UI as a command error. */
export const importErrorCodes = [
	// EPUB extraction
	'invalid_epub',
	'epub_encrypted',
	'epub_limit_exceeded',
	'epub_doctype',
	'epub_no_text',
	'illustration_mismatch',
	// DOCX extraction (aligned with DocxImportError codes, plus DOCTYPE)
	'invalid_docx',
	'missing_document',
	'invalid_xml',
	'docx_doctype',
	// Shared no-body outcome (PDF also reports it as a typed extraction result)
	'no_extractable_text',
	// PDF extraction
	'invalid_pdf',
	// Markdown extraction
	'markdown_encoding',
	'no_body_text',
	// TXT extraction
	'txt_encoding_unknown',
	'txt_decoding_failed',
	'project_not_empty',
	// Wizard layout validation and import options
	'invalid_layout',
	'unsupported_source_format',
	'unsupported_reference_format',
	'reference_limit',
	'unknown_encoding',
	'invalid_illustration_selection',
	'relayout_volume_added',
	'project_folder_exists',
	// Joining an existing series
	'invalid_join_target',
	'join_series_missing',
	'join_series_invalid',
	'join_target_missing',
	'join_references_unsupported',
	'join_no_text',
	'join_empty_sections',
] as const
export type ImportErrorCode = (typeof importErrorCodes)[number]

/** Structured failure of an exported work package (share/export). */
export const shareErrorCodes = [
	'corrupt_package',
	'unsupported_format',
	'unsupported_reader',
	'write_failed',
	'stale_import',
	'invalid_selection',
	'internal',
] as const
export type ShareErrorCode = (typeof shareErrorCodes)[number]

function errorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null) return undefined
	if (!('code' in error)) return undefined
	const { code } = error
	return typeof code === 'string' ? code : undefined
}

/**
 * An import/extraction failure carrying its machine-readable code. Import
 * code sites throw this; the command boundary surfaces it as `importFailure`.
 */
export class ImportFailureError extends Error {
	override name = 'ImportFailureError'
	constructor(
		readonly code: ImportErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options)
	}
}

export type ImportFailure = {
	status: 'error'
	format: string
	code: ImportErrorCode
	detail?: string
}

/** Classify a raw extraction failure into its import error code. */
export function importFailure(format: string, error: unknown): ImportFailure {
	const message = error instanceof Error ? error.message : String(error)
	return {
		status: 'error',
		format,
		code: importErrorCode(format, error),
		...(message ? { detail: message } : {}),
	}
}

function importErrorCode(format: string, error: unknown): ImportErrorCode {
	const code = errorCode(error)
	if (code && (importErrorCodes as readonly string[]).includes(code))
		return code as ImportErrorCode
	switch (format) {
		case 'epub':
			return 'invalid_epub'
		case 'pdf':
			return 'invalid_pdf'
		case 'markdown':
			return 'no_body_text'
		default:
			return 'invalid_docx'
	}
}
