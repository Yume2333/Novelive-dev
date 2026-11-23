import { mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { directory, runRevisions, sceneId } from './fixture'

const parent = process.argv[2]
if (!parent) throw new Error('Usage: run.ts <folder>')
const folder = await mkdtemp(join(resolve(parent), 'run-'))
const run = await runRevisions(folder, { directory, mode: 'strict' })
const scene = run.applied.scenes.find((s) => s.sceneId === sceneId)
console.log(
	JSON.stringify(
		{
			project: run.project.root,
			hunks: run.proposal.hunks.length,
			applied: run.selected.map(({ id }) => id),
			scene: scene?.nvs,
			redraw: run.redrawn.status,
			candidates: run.choices.status,
		},
		null,
		2,
	),
)
run.project.close()
