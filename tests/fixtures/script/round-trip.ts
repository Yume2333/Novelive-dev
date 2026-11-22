import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Project } from '../../../packages/creator/src/project'
import { formatVersion, projectFiles } from '../../../packages/format/src/model'
import {
	compileScript,
	formatScene,
	formatScript,
} from '../../../packages/format/src/script'
import { ref, seed } from '../project-schema/seed'
import { context } from './context'

const [directory] = process.argv.slice(2)
if (!directory) throw new Error('Usage: round-trip <new-project-directory>')
await seed(directory)
const source = await readFile(
	new URL('./synthetic.nvs', import.meta.url),
	'utf8',
)
let saved: string
let sceneIds: string[]
{
	using project = await Project.open(directory)
	const chapter = await project.read(projectFiles.chapter(ref))
	await project.write(projectFiles.assetRegistry({ level: 'series' }), {
		formatVersion,
		entries: context.assets,
	})
	const registry = await project.read(
		projectFiles.assetRegistry({ level: 'series' }),
	)
	const result = compileScript(source, {
		...context,
		paragraphIds: chapter.paragraphIds,
		assets: registry.entries,
	})
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	const scenes = result.scenes.map(({ scene }) => scene)
	sceneIds = scenes.map(({ id }) => {
		assert.ok(id)
		return id
	})
	for (const scene of scenes) {
		assert.ok(scene.id)
		await project.writeFile(
			projectFiles.scene(ref, scene.id),
			formatScene(scene),
		)
	}
	await project.write(projectFiles.chapter(ref), { ...chapter, sceneIds })
	saved = formatScript(scenes)
	console.log(
		`Compiled and saved ${sceneIds.length} .nvs files with ${result.scenes.flatMap(({ beats }) => beats).length} playback beats.`,
	)
}
{
	using project = await Project.open(directory)
	const chapter = await project.read(projectFiles.chapter(ref))
	const stored = (
		await Promise.all(
			chapter.sceneIds.map(async (id) =>
				(await project.readFile(projectFiles.scene(ref, id))).toString('utf8'),
			),
		)
	).join('\n')
	assert.equal(stored, saved)
	const result = compileScript(stored, {
		...context,
		sceneIds: chapter.sceneIds,
	})
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
	assert.deepEqual(
		chapter.sceneIds,
		result.scenes.map(({ scene }) => scene.id),
	)
	assert.equal(formatScript(result.scenes.map(({ scene }) => scene)), stored)
	console.log(
		'Reopened the project; scene IDs, serialized sentence IDs, and canonical .nvs text round-trip.',
	)
}
