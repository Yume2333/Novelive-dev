import { randomUUID } from 'node:crypto'
import {
	access,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { compile } from '@earendil-works/pi-schema'
import {
	formatVersion,
	type ProjectDocument,
	projectFiles,
	type Series,
	workSchema,
} from '@novelive/format/model'
import { openProjectDatabase, ProjectTasks } from './database'
import { ProjectError } from './error'

export { ProjectError } from './error'

function projectPath(root: string, relative: string) {
	const segments = relative.split('/')
	if (
		segments.some(
			(part) => !part || part === '.' || part === '..' || /[\\:\0]/.test(part),
		)
	) {
		throw new Error(`Invalid relative project path: ${relative}`)
	}
	return join(root, ...segments)
}

function decode<T>(file: ProjectDocument<T>, input: unknown): T {
	if (input && typeof input === 'object') {
		if (
			'formatVersion' in input &&
			typeof input.formatVersion === 'number' &&
			input.formatVersion > formatVersion
		) {
			throw new ProjectError(
				'unsupported_format',
				file.path,
				`formatVersion ${input.formatVersion}; update the app`,
			)
		}
		if (
			file.schema === workSchema &&
			'minReaderVersion' in input &&
			typeof input.minReaderVersion === 'number' &&
			input.minReaderVersion > formatVersion
		) {
			throw new ProjectError(
				'unsupported_reader',
				file.path,
				`minReaderVersion ${input.minReaderVersion}; update the app`,
			)
		}
	}
	const result = compile(file.schema).validate(input)
	if (!result.ok) {
		throw new ProjectError(
			'invalid_document',
			file.path,
			JSON.stringify(result.errors),
		)
	}
	return result.value
}

async function readDocument<T>(
	root: string,
	file: ProjectDocument<T>,
): Promise<T> {
	const contents = await readFile(projectPath(root, file.path), 'utf8')
	let input: unknown
	try {
		input = JSON.parse(contents)
	} catch (cause) {
		throw new ProjectError('invalid_document', file.path, 'invalid JSON', {
			cause,
		})
	}
	return decode(file, input)
}

export class Project {
	readonly tasks: ProjectTasks

	private constructor(
		readonly root: string,
		readonly database: DatabaseSync,
	) {
		this.tasks = new ProjectTasks(database)
	}

	static async create(directory: string, series: Series): Promise<Project> {
		const root = resolve(directory)
		decode(projectFiles.series, series)
		await mkdir(root)
		const project = new Project(
			root,
			openProjectDatabase(join(root, projectFiles.database), true),
		)
		try {
			await project.write(projectFiles.series, series)
			return project
		} catch (error) {
			project.close()
			throw error
		}
	}

	static async open(directory: string): Promise<Project> {
		const root = resolve(directory)
		await readDocument(root, projectFiles.series)
		const path = join(root, projectFiles.database)
		await access(path)
		return new Project(root, openProjectDatabase(path, false))
	}

	read<T>(file: ProjectDocument<T>): Promise<T> {
		return readDocument(this.root, file)
	}

	async write<T>(file: ProjectDocument<T>, value: NoInfer<T>): Promise<void> {
		const json = JSON.stringify(value, null, '\t')
		decode(file, JSON.parse(json))
		await this.writeFile(file.path, `${json}\n`)
	}

	readFile(relative: string): Promise<Buffer> {
		return readFile(projectPath(this.root, relative))
	}

	async writeFile(relative: string, value: string | Uint8Array): Promise<void> {
		const path = projectPath(this.root, relative)
		const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
		await mkdir(dirname(path), { recursive: true })
		await writeFile(temporary, value, { flag: 'wx' })
		try {
			await rename(temporary, path)
		} catch (error) {
			await rm(temporary, { force: true })
			throw error
		}
	}

	close() {
		this.database.close()
	}

	[Symbol.dispose]() {
		this.close()
	}
}
