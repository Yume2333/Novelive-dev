import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { testImage } from '../../packages/creator/src/models/image/index.js'

vi.mock('../../packages/creator/src/models/image/index.js', () => ({
	testImage: vi.fn(),
}))

const dirs: string[] = []
afterEach(async () => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	vi.resetAllMocks()
	vi.resetModules()
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })))
})

async function setup() {
	const dir = await mkdtemp(join(tmpdir(), 'novelive-image-ledger-'))
	dirs.push(dir)
	vi.stubEnv('HOME', dir)
	vi.stubEnv('USERPROFILE', dir)
	vi.stubEnv('NL_REPLAY', 'record')
	vi.stubEnv('NL_CASSETTE_DIR', join(dir, 'cassettes'))
	vi.stubEnv('NL_IMAGE_BASE_URL', 'https://relay.invalid')
	vi.stubEnv('NL_IMAGE_API_KEY', 'mock-key')
	return dir
}

it('records a paid timeout as an unresolved upper bound', async () => {
	const dir = await setup()
	const ledger = join(dir, 'memory/poke_5b9601/files/novelive/usage.csv')
	await mkdir(dirname(ledger), { recursive: true })
	await writeFile(ledger, 'date,model,calls,tokens,images,purpose\n')
	const timeout = new DOMException('Timed out', 'TimeoutError')
	const upstream = vi.fn().mockRejectedValue(timeout)
	vi.stubGlobal('fetch', upstream)
	vi.mocked(testImage).mockImplementation(async (_, options) => {
		await expect(
			options.replay?.fetch?.('https://relay.invalid/v1/images/generations', {
				method: 'POST',
				body: '{}',
			}),
		).rejects.toBe(timeout)
		return {} as Awaited<ReturnType<typeof testImage>>
	})
	await import('../fixtures/image-models/smoke.js')
	expect(upstream).toHaveBeenCalledTimes(1)
	expect(await readFile(ledger, 'utf8')).toContain(
		',gpt-image-2.6-sunburst,1,unknown,1,M0/12 generate connection smoke unresolved/timeout (requested image upper bound)\n',
	)
})
