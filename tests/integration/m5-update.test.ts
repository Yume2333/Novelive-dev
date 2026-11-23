import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UpdateInfo } from 'electron-updater'
import { describe, expect, it, vi } from 'vitest'
import {
	checkUpdate,
	updatePolicy,
} from '../../apps/desktop/src/main/update/policy'
// @ts-expect-error 开发工具的 ESM 入口
import * as licenses from '../../tools/licenses/generate.mjs'

const feed = 'http://127.0.0.1:8080/artifacts'
const sha512 = Buffer.alloc(64, 1).toString('base64')

function fromMetadata(files: string[], isUpdateAvailable = true) {
	const updateInfo: UpdateInfo = {
		version: '0.1.1',
		files: files.map((url) => ({ url, sha512 })),
		path: files[0],
		sha512,
		releaseDate: '2026-11-22T00:00:00.000Z',
	}
	return {
		checkForUpdates: vi.fn(async () => ({
			isUpdateAvailable,
			updateInfo,
			versionInfo: updateInfo,
		})),
		downloadUpdate: vi.fn(async () => files),
	}
}

describe('M5 本地应用更新', () => {
	it('requires a packaged app and an explicitly configured trusted feed', () => {
		expect(updatePolicy(true, 'win32', false)).toBeUndefined()
		expect(updatePolicy(false, 'win32', false, feed)).toBeUndefined()
		expect(
			updatePolicy(true, 'win32', false, 'http://example.com/'),
		).toBeUndefined()
		expect(
			updatePolicy(true, 'win32', false, 'file:///tmp/feed/'),
		).toBeUndefined()
		expect(
			updatePolicy(true, 'win32', false, 'https://example.com/feed'),
		).toEqual({
			mode: 'nsis',
			feed: 'https://example.com/feed/',
		})
	})

	it.each([
		['win32', false, 'nsis', 'Novelive-0.1.1-win-x64.exe'],
		['linux', true, 'appimage', 'Novelive-0.1.1-linux-x64.AppImage'],
	] as const)(
		'%s %s downloads an update only when newer',
		async (host, appImage, mode, file) => {
			const policy = updatePolicy(true, host, appImage, feed)
			expect(policy?.mode).toBe(mode)
			if (!policy) throw new Error('Missing updater policy')
			const current = fromMetadata([file], false)
			await expect(checkUpdate(current, policy)).resolves.toEqual({
				kind: 'current',
			})
			expect(current.downloadUpdate).not.toHaveBeenCalled()
			const newer = fromMetadata([file])
			await expect(checkUpdate(newer, policy)).resolves.toEqual({
				kind: 'ready',
				version: '0.1.1',
			})
			expect(newer.downloadUpdate).toHaveBeenCalledTimes(1)
		},
	)

	it.each([
		['darwin', 'Novelive.zip', 'Novelive.dmg'],
		['linux', 'Novelive.AppImage', 'Novelive.deb'],
	] as const)(
		'%s offers the appropriate manual installer without downloading',
		async (host, other, installer) => {
			const policy = updatePolicy(true, host, false, feed)
			if (!policy) throw new Error('Missing updater policy')
			const updater = fromMetadata([other, installer])
			await expect(checkUpdate(updater, policy)).resolves.toEqual({
				kind: 'manual',
				version: '0.1.1',
				url: `${feed}/${installer}`,
			})
			expect(updater.downloadUpdate).not.toHaveBeenCalled()
			const noInstaller = fromMetadata([other, `file:///${installer}`])
			await expect(checkUpdate(noInstaller, policy)).resolves.toMatchObject({
				url: `${feed}/`,
			})
			expect(noInstaller.downloadUpdate).not.toHaveBeenCalled()
		},
	)
})

it('includes the component list shipped in the Windows sharp binary README', async () => {
	const scratch = await mkdtemp(join(tmpdir(), 'novelive-sharp-notices-'))
	const component = '| libvips | LGPLv3 |'
	try {
		await writeFile(join(scratch, 'LICENSE'), 'Apache-2.0')
		await writeFile(join(scratch, 'README.md'), component)
		await expect(
			licenses.readPackageLicenses(scratch, '@img/sharp-win32-x64'),
		).resolves.toEqual(['Apache-2.0', component])
	} finally {
		await rm(scratch, { recursive: true, force: true })
	}
})

it('generates licensing from the production graph and local bundled models', async () => {
	const scratch = await mkdtemp(join(tmpdir(), 'novelive-notices-'))
	try {
		const file = join(scratch, 'THIRD_PARTY_NOTICES.txt')
		await licenses.generateNotices(file)
		const notices = await readFile(file, 'utf8')
		expect(notices).toContain('LICENSES.chromium.html')
		expect(notices).toContain('electron-updater@')
		expect(notices).toContain('@fontsource/noto-sans-sc@')
		expect(notices).toContain('GNU LESSER GENERAL PUBLIC LICENSE')
		expect(notices).toContain('https://github.com/libvips/libvips/releases/')
		expect(notices).toContain('ncnn-BSD-3.txt')
		expect(notices).toContain('4x-NMKD-YandereNeo')
		expect(notices).toContain('U²-NetP')
	} finally {
		await rm(scratch, { recursive: true, force: true })
	}
})
