import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	verifyChecksums,
	verifyPackage, // @ts-expect-error plain ESM packaging tool
} from '../../tools/package/verify-artifacts.mjs'

let dist: string

function sha256(content: string | Buffer) {
	return createHash('sha256').update(content).digest('hex')
}

async function fixture(
	platform: 'linux' | 'win32' | 'darwin',
	options: { resources?: boolean; sums?: string } = {},
) {
	const pkg = await mkdtemp(join(tmpdir(), `novelive-verify-${platform}-`))
	const artifacts = join(pkg, 'artifacts')
	await mkdir(artifacts, { recursive: true })
	const files = {
		linux: ['Novelive-0.0.0-linux.AppImage', 'latest-linux.yml'],
		win32: ['Novelive Setup 0.0.0.exe', 'latest.yml'],
		darwin: ['Novelive-0.0.0.dmg', 'Novelive-0.0.0-mac.zip', 'latest-mac.yml'],
	}[platform]
	for (const name of files)
		await writeFile(join(artifacts, name), `payload:${name}`)
	await writeFile(
		join(artifacts, 'SHA256SUMS'),
		options.sums ??
			files.map((name) => `${sha256(`payload:${name}`)}  ${name}`).join('\n') +
				'\n',
	)
	await writeFile(join(artifacts, 'BUILD.txt'), 'Novelive 0.0.0\n')
	if (options.resources !== false) {
		const resources =
			platform === 'linux'
				? join(pkg, 'linux-unpacked', 'resources')
				: platform === 'win32'
					? join(pkg, 'win-unpacked', 'resources')
					: join(pkg, 'mac-arm64', 'Novelive.app', 'Contents', 'Resources')
		await mkdir(join(resources, 'licenses'), { recursive: true })
		await writeFile(join(resources, 'licenses', 'LICENSE.txt'), 'GPL-3\n')
		await writeFile(
			join(resources, 'licenses', 'THIRD_PARTY_NOTICES.txt'),
			'sharp LGPLv3\n',
		)
	}
	return pkg
}

describe('M5 packaged artifact verification', () => {
	beforeEach(() => {
		dist = ''
	})
	afterEach(async () => {
		if (dist) await rm(dist, { recursive: true, force: true })
	})

	it.each(['linux', 'win32', 'darwin'] as const)(
		'accepts a complete %s package with checksummed artifacts and licenses',
		async (platform) => {
			dist = await fixture(platform)
			const result = await verifyPackage(dist, platform)
			expect(result.checksums).toBe(platform === 'darwin' ? 3 : 2)
			expect(result.resources).toBe(1)
		},
	)

	it('rejects an artifact file not covered by SHA256SUMS', async () => {
		dist = await fixture('linux')
		await writeFile(join(dist, 'artifacts', 'extra.zip'), 'unsigned')
		await expect(verifyPackage(dist, 'linux')).rejects.toThrow(
			/missing from SHA256SUMS/,
		)
	})

	it('rejects a checksum that does not match the artifact bytes', async () => {
		dist = await fixture('linux', {
			sums: `${'0'.repeat(64)}  Novelive-0.0.0-linux.AppImage\n${sha256('payload:latest-linux.yml')}  latest-linux.yml\n`,
		})
		await expect(verifyChecksums(join(dist, 'artifacts'))).rejects.toThrow(
			/Checksum mismatch/,
		)
	})

	it('rejects when THIRD_PARTY_NOTICES.txt is absent from resources', async () => {
		dist = await fixture('win32', { resources: false })
		await expect(verifyPackage(dist, 'win32')).rejects.toThrow(
			/unpacked resources/,
		)
	})
})
