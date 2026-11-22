import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createConfigStore } from '../../packages/creator/src/config'

test('production settings extend a legacy config without changing its model slots', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'novelive-production-config-'))
	try {
		const legacy = createConfigStore(profile)
		await legacy.update({
			models: {
				fast: { model: 'fixture-fast', apiKey: 'offline-fixture' },
				writing: { model: 'fixture-writer' },
				main: { model: 'fixture-main' },
			},
		})
		expect(
			JSON.parse(await readFile(join(profile, 'config.json'), 'utf8')),
		).not.toHaveProperty('production')

		const store = createConfigStore(profile)
		expect(await store.resolveRoleModel('writer')).toMatchObject({
			model: 'fixture-writer',
		})
		const baseline = await store.resolveWriterPreset()
		const custom = {
			...baseline,
			id: 'custom',
			name: '自定义',
			temperature: 0.7,
		}
		await store.update({
			production: {
				roleModels: { writer: 'main' },
				writer: { defaultPresetId: 'custom', presets: [baseline, custom] },
			},
		})
		await store.update({ production: { roleModels: { organizer: 'writing' } } })
		const reopened = createConfigStore(profile)
		expect(await reopened.resolveRoleModel('writer')).toMatchObject({
			model: 'fixture-main',
			apiKey: 'offline-fixture',
		})
		expect(await reopened.resolveRoleModel('organizer')).toMatchObject({
			model: 'fixture-writer',
		})
		expect(await reopened.resolveWriterPreset('default')).toEqual(baseline)
		expect(await reopened.resolveWriterPreset('missing')).toEqual(custom)
		expect(await reopened.get()).not.toHaveProperty('models.fast.apiKey')
		await expect(
			reopened.update({
				production: {
					writer: { defaultPresetId: 'missing', presets: [baseline] },
				},
			}),
		).rejects.toMatchObject({ code: 'invalid_config' })
		expect(await reopened.resolveWriterPreset()).toEqual(custom)
	} finally {
		await rm(profile, { recursive: true, force: true })
	}
})
