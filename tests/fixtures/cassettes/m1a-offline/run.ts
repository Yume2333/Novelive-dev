import assert from 'node:assert/strict'
import { importFixture, runGate, strictFetch } from './gate'

const [root, mode] = process.argv.slice(2)
assert.ok(root && (mode === 'create' || mode === 'reopen'))
if (mode === 'create') await importFixture(root)
const requests = await runGate(root, strictFetch())
assert.equal(requests, mode === 'create' ? 7 : 0)
console.log(
	`${mode}: 2 volumes, 3 chapters, original and report preserved, previews, digests, skeletons, glossary and conflict review verified; ${requests} replay requests.`,
)
