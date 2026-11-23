import { corrupt, PackageCodecError } from '../codec/error'
import {
	type PackageJson,
	type PackageJsonMigration,
	packageFormatVersion,
	packageVersionStatus,
} from '../contract'

// Format 1 is the first released format.
export const packageMigrations: readonly PackageJsonMigration[] = []

export function versionedDocument(
	path: string,
	input: unknown,
	isWork: boolean,
): PackageJson {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw corrupt(path, 'expected a versioned JSON object')

	const document = input as PackageJson
	const reader = isWork ? document.minReaderVersion : undefined
	switch (packageVersionStatus(document.formatVersion, reader)) {
		case 'unsupported_format':
			throw new PackageCodecError(
				'unsupported_format',
				`${path}: formatVersion ${document.formatVersion}; update the app`,
			)
		case 'unsupported_reader':
			throw new PackageCodecError(
				'unsupported_reader',
				`${path}: minReaderVersion ${reader}; update the app`,
			)
		case 'invalid_version':
			throw corrupt(path, 'invalid package version')
		default:
			return document
	}
}

export function migratePackageJson(
	path: string,
	document: PackageJson,
	migrations = packageMigrations,
	target = packageFormatVersion,
): PackageJson {
	while (document.formatVersion < target) {
		const from = document.formatVersion
		const step = migrations.find((migration) => migration.from === from)
		if (!step || step.to !== from + 1)
			throw corrupt(path, `missing migration from format ${from}`)
		document = step.migrate(path, document)
		if (document.formatVersion !== step.to)
			throw corrupt(path, `migration did not produce format ${step.to}`)
	}
	return document
}
