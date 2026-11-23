import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@earendil-works/pi-schema'
import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import sharp from 'sharp'
import { afterEach, expect, test } from 'vitest'
import { importCommands } from '../../packages/creator/src/contract/import'
import {
	importFileProject,
	readImportWizard,
	reviseTxtProject,
} from '../../packages/creator/src/import/wizard'
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
async function workspace() {
	const root = await mkdtemp(join(tmpdir(), 'novelive-formats-'))
	roots.push(root)
	return root
}
const fixture = (path: string) =>
	readFile(new URL(`../fixtures/source/${path}`, import.meta.url))
async function epub() {
	const zip = new ZipWriter(new Uint8ArrayWriter())
	for (const [name, text] of Object.entries({
		'META-INF/container.xml':
			'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
		'book.opf':
			'<package><metadata/><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="body"/></spine></package>',
		'body.xhtml':
			'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><h1>第一章 门</h1><p>她推开门。</p><aside epub:type="footnote"><p>注释不进正文</p></aside><h1>第二章 路</h1><p>路很长。</p></body></html>',
	}))
		await zip.add(name, new TextReader(text))
	return zip.close()
}

test.each(['epub', 'docx'] as const)(
	'%s only persists explicitly selected illustrations as references',
	async (format) => {
		const root = await workspace()
		const sourcePath = join(root, `source.${format}`)
		await writeFile(sourcePath, await illustratedBook(format, 4))
		const external = join(root, 'external.png')
		await writeFile(
			external,
			await sharp({
				create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
			})
				.png()
				.toBuffer(),
		)
		const result = await importFileProject({
			sourcePath,
			folder: root,
			title: '插图',
			references: [external],
		})
		if (result.status !== 'ready') throw new Error('Expected ready')
		expect(compile(importCommands['import.file'].output).check(result)).toBe(
			true,
		)
		expect(result.illustrations).toHaveLength(4)
		expect(result.selectedIllustrations).toEqual([])
		expect(result.references).toEqual(['source/references/01.png'])
		for (const candidate of result.illustrations) {
			expect(candidate).toMatchObject({ volume: 0, chapter: 0 })
			expect(candidate).not.toHaveProperty('cachePath')
			const preview = await sharp(
				Buffer.from(candidate.preview.split(',')[1], 'base64'),
			).metadata()
			expect(preview.format).toBe('png')
			expect(preview.width).toBeLessThanOrEqual(192)
		}
		await expect(
			reviseTxtProject(result.projectDir, result.layout, ['unknown']),
		).rejects.toMatchObject({ message: '插图选择无效' })
		await expect(
			reviseTxtProject(result.projectDir, result.layout, [
				'illustration-1',
				'illustration-1',
			]),
		).rejects.toMatchObject({ message: '插图选择无效' })
		await expect(
			reviseTxtProject(result.projectDir, result.layout, [
				'illustration-1',
				'illustration-2',
				'illustration-3',
			]),
		).rejects.toMatchObject({ message: '最多选择 3 张参考图' })
		const selected = await reviseTxtProject(result.projectDir, result.layout, [
			'illustration-2',
		])
		expect(selected.references).toEqual([
			'source/references/01.png',
			'source/references/illustration-2.png',
		])
		expect(selected.selectedIllustrations).toEqual(['illustration-2'])
		using project = await Project.open(result.projectDir)
		expect(
			(await sharp(await project.readFile(selected.references[1])).metadata())
				.format,
		).toBe('png')
		expect((await readImportWizard(project)).selectedIllustrations).toEqual([
			'illustration-2',
		])
		expect(await readdir(join(result.projectDir, 'source/references'))).toEqual(
			['01.png', 'illustration-2.png'],
		)
		expect(
			(await reviseTxtProject(result.projectDir, result.layout)).references,
		).toEqual(selected.references)
		expect(
			(await reviseTxtProject(result.projectDir, result.layout, [])).references,
		).toEqual(['source/references/01.png'])
	},
)

test.each(['epub', 'docx'] as const)(
	'%s safely omits invalid images and caps candidates',
	async (format) => {
		const root = await workspace()
		const sourcePath = join(root, `source.${format}`)
		await writeFile(
			sourcePath,
			await illustratedBook(
				format,
				2,
				new TextEncoder().encode('<svg>not an image'),
			),
		)
		const invalid = await importFileProject({
			sourcePath,
			folder: root,
			title: '无图片',
			references: [],
		})
		expect(invalid).toMatchObject({
			status: 'ready',
			illustrations: [],
			selectedIllustrations: [],
			references: [],
		})
		await writeFile(sourcePath, await illustratedBook(format, 42))
		const capped = await importFileProject({
			sourcePath,
			folder: root,
			title: '图片上限',
			references: [],
		})
		if (capped.status !== 'ready') throw new Error('Expected ready')
		expect(capped.illustrations).toHaveLength(40)
		expect(capped.references).toEqual([])
	},
)

test.each(['txt', 'epub', 'md', 'markdown', 'docx', 'pdf'])(
	'%s reaches the disk wizard and preserves layout and notes on revision',
	async (extension) => {
		const root = await workspace()
		const bytes =
			extension === 'txt'
				? await fixture('txt/multivolume.txt')
				: extension === 'md' || extension === 'markdown'
					? await fixture('markdown/multivolume.md')
					: extension === 'pdf'
						? await fixture('pdf/notes.pdf')
						: extension === 'epub'
							? await epub()
							: await syntheticDocx({
									'word/document.xml': documentXml(
										paragraph('第一卷 风', '<w:pStyle w:val="Heading1"/>') +
											paragraph('第一章 门', '<w:pStyle w:val="Heading2"/>') +
											paragraph('她推开门。') +
											paragraph('注：注释不进正文') +
											paragraph('第二卷 雨', '<w:pStyle w:val="Heading1"/>') +
											paragraph('第二章 路', '<w:pStyle w:val="Heading2"/>') +
											paragraph('路很长。'),
									),
								})
		const sourcePath = join(root, `source.${extension.toUpperCase()}`)
		await writeFile(sourcePath, bytes)
		const result = await importFileProject({
			sourcePath,
			folder: root,
			title: '五种格式',
			references: [],
			encoding: 'utf-8',
		})
		expect(compile(importCommands['import.file'].output).check(result)).toBe(
			true,
		)
		if (result.status !== 'ready') throw new Error('Expected ready')
		expect(result.illustrations).toEqual([])
		expect(result.selectedIllustrations).toEqual([])
		expect(result.format).toBe(
			['md', 'markdown'].includes(extension) ? 'markdown' : extension,
		)
		expect(result.encoding).toBe(extension === 'txt' ? 'utf-8' : undefined)
		expect(result.workIds).toHaveLength(result.layout.volumes.length)
		expect(new Set(result.workIds).size).toBe(result.workIds.length)
		expect(result.paragraphs).toBeGreaterThan(0)
		using project = await Project.open(result.projectDir)
		expect(
			await project.readFile(
				projectFiles.original(
					extension === 'markdown'
						? 'md'
						: (extension as 'txt' | 'epub' | 'md' | 'docx' | 'pdf'),
				),
			),
		).toEqual(Buffer.from(bytes))
		const contents = async () => {
			const files = await readdir(join(result.projectDir, 'source/chapters'))
			return Object.fromEntries(
				await Promise.all(
					files.map(async (name) => [
						name,
						await readFile(
							join(result.projectDir, 'source/chapters', name),
							'utf8',
						),
					]),
				),
			)
		}
		const before = await contents()
		if (extension === 'docx' || extension === 'epub') {
			expect(
				Object.entries(before)
					.filter(([name]) => !name.includes('.notes.'))
					.map(([, text]) => text)
					.join(''),
			).not.toContain('注释不进正文')
			expect(
				Object.entries(before)
					.filter(([name]) => name.includes('.notes.'))
					.map(([, text]) => text)
					.join(''),
			).toContain('注释不进正文')
		}
		const revised = await reviseTxtProject(result.projectDir, {
			...result.layout,
			title: '修订',
			chapters: result.layout.chapters.map((chapter, i) => ({
				...chapter,
				title: `章节 ${i + 1}`,
			})),
		})
		expect(revised.format).toBe(result.format)
		expect(revised.workIds).toEqual(result.workIds)
		expect(revised.layout.title).toBe('修订')
		expect(await contents()).toEqual(before)
	},
)

test('scanned and blank PDFs return unsupported without creating a project', async () => {
	for (const name of ['image-only', 'blank']) {
		const root = await workspace()
		const sourcePath = join(root, 'scan.pdf')
		await writeFile(sourcePath, await fixture(`pdf/${name}.pdf`))
		const result = await importFileProject({
			sourcePath,
			folder: root,
			title: '扫描',
			references: [],
		})
		expect(result).toEqual({
			status: 'unsupported',
			format: 'pdf',
			reason: 'no_extractable_text',
		})
		expect(compile(importCommands['import.file'].output).check(result)).toBe(
			true,
		)
		expect(await readdir(root)).toEqual(['scan.pdf'])
	}
})

test('unsupported extensions and corrupt files leave no project', async () => {
	for (const extension of ['html', 'epub', 'docx', 'pdf', 'md']) {
		const root = await workspace()
		const sourcePath = join(root, `broken.${extension}`)
		await writeFile(sourcePath, Buffer.from([0xff, 0xfe, 0]))
		await expect(
			importFileProject({
				sourcePath,
				folder: root,
				title: '损坏',
				references: [],
			}),
		).rejects.toBeDefined()
		expect(await readdir(root)).toEqual([`broken.${extension}`])
	}
})

test('only TXT returns encoding choices', async () => {
	const root = await workspace()
	const sourcePath = join(root, 'ambiguous.txt')
	await writeFile(sourcePath, Buffer.from('a4a4', 'hex'))
	const result = await importFileProject({
		sourcePath,
		folder: root,
		title: '编码',
		references: [],
	})
	expect(result.status).toBe('encoding')
	expect(await readdir(root)).toEqual(['ambiguous.txt'])
})
