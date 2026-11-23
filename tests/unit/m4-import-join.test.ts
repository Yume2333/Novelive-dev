import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { afterEach, expect, test } from 'vitest'
import { importCommands } from '../../packages/creator/src/contract/import'
import {
	importFileProject,
	reviseTxtProject,
} from '../../packages/creator/src/import/wizard'
import { readImportTarget } from '../../packages/creator/src/import/wizard/join'
import { Project } from '../../packages/creator/src/project'
import { projectFiles } from '../../packages/format/src/model'
import {
	documentXml,
	paragraph,
	syntheticDocx,
} from '../fixtures/source/docx/synthetic'
import { illustratedBook } from '../fixtures/source/illustrations'

const roots: string[] = []
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

async function existingProject() {
	const root = await mkdtemp(join(tmpdir(), 'novelive-join-'))
	roots.push(root)
	const sourcePath = join(root, 'first.md')
	await writeFile(sourcePath, '# 第一卷\n\n## 第一章\n\n既有正文。')
	const initial = await importFileProject({
		sourcePath,
		folder: root,
		title: '已有系列',
		references: [],
	})
	if (initial.status !== 'ready') throw new Error('Expected ready')
	using project = await Project.open(initial.projectDir)
	const series = await project.read(projectFiles.series)
	const volumeId = series.volumeIds[0]
	const workFile = projectFiles.work(volumeId, initial.workId)
	const work = await project.read(workFile)
	await project.write(workFile, {
		...work,
		settings: { ...work.settings, confirmWithReferences: false },
	})
	for (const scope of [
		{ level: 'series' },
		{ level: 'volume', volumeId },
		{ level: 'work', volumeId, workId: initial.workId },
	] as const) {
		await project.write(projectFiles.character(scope, 'existing'), {
			formatVersion: 1,
			entries: [
				{
					id: 'existing',
					status: 'confirmed',
					name: '既有人物',
					originalName: '既有人物',
					aliases: [],
					appearance: { description: '保留外貌。' },
				},
			],
		})
		await project.writeFile(
			projectFiles.styles(scope),
			'/* existing style */\n',
		)
	}
	return {
		root,
		initial,
		series,
		settings: (await project.read(workFile)).settings,
	}
}

async function snapshot(
	root: string,
	prefix = '',
): Promise<Record<string, Buffer>> {
	const files: Record<string, Buffer> = {}
	for (const entry of await readdir(join(root, prefix), {
		withFileTypes: true,
	})) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) Object.assign(files, await snapshot(root, path))
		else if (path !== 'series.json' && !path.startsWith('project.db'))
			files[path] = await readFile(join(root, path))
	}
	return files
}

test.each(['md', 'docx', 'txt', 'epub', 'pdf'] as const)(
	'%s appends volumes in order without changing any existing bible/settings/source files',
	async (format) => {
		const { root, initial, series, settings } = await existingProject()
		const before = await snapshot(initial.projectDir)
		const sourcePath = join(root, `second.${format}`)
		const bytes =
			format === 'md'
				? Buffer.from(
						'# 第二卷\n\n## 新章一\n\n新的正文。\n\n# 第三卷\n\n## 新章二\n\n更远的正文。',
					)
				: format === 'docx'
					? await syntheticDocx({
							'word/document.xml': documentXml(
								paragraph('第二卷', '<w:pStyle w:val="Heading1"/>') +
									paragraph('新章一', '<w:pStyle w:val="Heading2"/>') +
									paragraph('新的正文。') +
									paragraph('第三卷', '<w:pStyle w:val="Heading1"/>') +
									paragraph('新章二', '<w:pStyle w:val="Heading2"/>') +
									paragraph('更远的正文。'),
							),
						})
					: format === 'txt'
						? Buffer.from(
								'第二卷 新书\n第一章 相遇\n新的正文。\n第二章 远行\n更远的正文。',
							)
						: format === 'epub'
							? await illustratedBook('epub')
							: await readFile(
									new URL('../fixtures/source/pdf/notes.pdf', import.meta.url),
								)
		await writeFile(sourcePath, bytes)
		const target = await readImportTarget(initial.projectDir)
		expect(target).toEqual({
			projectDir: initial.projectDir,
			seriesId: series.seriesId,
			title: '已有系列',
		})
		const result = await importFileProject({
			sourcePath,
			folder: root,
			title: '新书',
			encoding: 'utf-8',
			references: [],
			join: { projectDir: initial.projectDir, seriesId: series.seriesId },
		})
		expect(compile(importCommands['import.file'].output).check(result)).toBe(
			true,
		)
		if (result.status !== 'joined') throw new Error('Expected joined')
		expect(result.projectDir).toBe(initial.projectDir)
		expect(result.workIds).toEqual(
			result.volumes.map((volume) => volume.workId),
		)
		expect(result.workIds).not.toContain(initial.workId)
		if (format === 'md' || format === 'docx')
			expect(result.volumes.map((volume) => volume.title)).toEqual([
				'第二卷',
				'第三卷',
			])
		using project = await Project.open(initial.projectDir)
		expect((await project.read(projectFiles.series)).volumeIds).toEqual([
			...series.volumeIds,
			...result.volumes.map((volume) => volume.volumeId),
		])
		for (const volume of result.volumes) {
			const work = await project.read(
				projectFiles.work(volume.volumeId, volume.workId),
			)
			expect(work.settings).toEqual(settings)
			expect(work.chapterIds).toHaveLength(volume.chapters)
			expect(
				await project.readFile(
					`source/imports/${volume.volumeId}/original.${format}`,
				),
			).toEqual(Buffer.from(bytes))
		}
		for (const [path, bytes] of Object.entries(before))
			expect(await project.readFile(path), path).toEqual(bytes)
		await expect(
			reviseTxtProject(initial.projectDir, initial.layout),
		).rejects.toMatchObject({
			code: 'invalid_config',
			message: '系列已添加新卷，不能重新划分原文',
		})
	},
)

test('rejects missing/corrupt targets, wrong series IDs and empty books without changing the target', async () => {
	const { root, initial, series } = await existingProject()
	const before = await snapshot(initial.projectDir)
	const beforeSeries = await readFile(join(initial.projectDir, 'series.json'))
	await expect(readImportTarget(root)).rejects.toMatchObject({
		code: 'invalid_config',
		message: '请选择有效的 Novelive 工程文件夹',
	})
	await expect(readImportTarget(join(root, 'missing'))).rejects.toMatchObject({
		code: 'invalid_config',
	})
	const sourcePath = join(root, 'second.md')
	await writeFile(sourcePath, '# 第二章\n\n正文。')
	const options = {
		sourcePath,
		folder: root,
		title: '新书',
		references: [],
		join: { projectDir: initial.projectDir, seriesId: 'missing-series' },
	}
	await expect(importFileProject(options)).rejects.toMatchObject({
		code: 'invalid_config',
		message: '所选系列不存在，请重新选择工程',
	})
	await expect(
		importFileProject({
			...options,
			join: { projectDir: root, seriesId: series.seriesId },
		}),
	).rejects.toMatchObject({ code: 'invalid_config' })
	const txt = join(root, 'empty.txt')
	await writeFile(txt, '')
	await expect(
		importFileProject({
			...options,
			sourcePath: txt,
			encoding: 'utf-8',
			join: { projectDir: initial.projectDir, seriesId: series.seriesId },
		}),
	).rejects.toMatchObject({ code: 'invalid_config' })
	await expect(
		importFileProject({
			...options,
			references: ['external.png'],
			join: { projectDir: initial.projectDir, seriesId: series.seriesId },
		}),
	).rejects.toMatchObject({
		code: 'invalid_config',
		message: '加入已有系列时不支持添加参考图',
	})
	expect(await readFile(join(initial.projectDir, 'series.json'))).toEqual(
		beforeSeries,
	)
	expect(await snapshot(initial.projectDir)).toEqual(before)
})
