import { EventEmitter, once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import type { CreatorFrame } from '../../packages/creator/src/contract'

const registration = vi.hoisted(() => ({ attempted: [] as string[] }))

vi.mock(
	'../../packages/creator/src/project/production',
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import('../../packages/creator/src/project/production')
			>()
		return {
			...actual,
			createProduction(...args: Parameters<typeof actual.createProduction>) {
				const service = actual.createProduction(...args)
				return {
					...service,
					async remember(workId: string, projectDir: string) {
						registration.attempted.push(workId)
						if (registration.attempted.length === 2) {
							const first = join(args[0], 'projects', registration.attempted[0])
							expect(await readFile(first, 'utf8')).toBe(projectDir)
							throw { code: 'invalid_config', message: 'Registration failed' }
						}
						await service.remember(workId, projectDir)
					},
				}
			},
		}
	},
)

test('worker rolls back the project and first binding if registration of the second volume fails', async () => {
	const root = await mkdtemp(join(tmpdir(), 'novelive-import-worker-'))
	const profile = join(root, 'profile')
	const sourcePath = join(root, 'source.txt')
	const parent = new EventEmitter()
	const port = new EventEmitter()
	const transport = Object.assign(port, {
		start() {},
		postMessage(frame: CreatorFrame) {
			port.emit('frame', frame)
		},
	})
	const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort')
	Object.defineProperty(process, 'parentPort', {
		configurable: true,
		value: {
			once: parent.once.bind(parent),
			postMessage: (frame: unknown) => parent.emit('frame', frame),
		},
	})
	vi.stubEnv('NL_CREATOR_GENERATION', '1')
	vi.stubEnv('NL_CREATOR_DATA_DIR', profile)
	try {
		await writeFile(
			sourcePath,
			'第一卷 出发\n第一章 门\n她推开门。\n第二卷 归来\n第二章 路\n她沿路回来。',
		)
		await import('../../packages/creator/src/entry')
		const ready = once(parent, 'frame')
		parent.emit('message', { ports: [transport] })
		expect(await ready).toEqual([{ type: 'ready', generation: 1 }])
		const response = once(transport, 'frame')
		transport.emit('message', {
			data: {
				type: 'call',
				generation: 1,
				requestId: 1,
				command: 'import.file',
				payload: {
					sourcePath,
					folder: root,
					title: '系列',
					encoding: 'utf-8',
					references: [],
				},
			},
		})
		expect(await response).toMatchObject([
			{
				type: 'error',
				requestId: 1,
				error: { code: 'invalid_config', message: 'Registration failed' },
			},
		])
		expect(registration.attempted).toHaveLength(2)
		expect((await readdir(root)).sort()).toEqual(['profile', 'source.txt'])
		expect(await readdir(join(profile, 'projects'))).toEqual([])
	} finally {
		transport.emit('close')
		if (descriptor) Object.defineProperty(process, 'parentPort', descriptor)
		else Reflect.deleteProperty(process, 'parentPort')
		vi.unstubAllEnvs()
		await rm(root, { recursive: true, force: true })
	}
})
