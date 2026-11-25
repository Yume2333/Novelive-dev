import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const aliases = { windows: 'win32', macos: 'darwin' }
const platforms = ['linux', 'win32', 'darwin']
const licenseFiles = ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']
const unsummed = new Set(['SHA256SUMS', 'BUILD.txt'])

async function sha256File(path) {
	const hash = createHash('sha256')
	for await (const bytes of createReadStream(path)) hash.update(bytes)
	return hash.digest('hex')
}

export async function verifyChecksums(artifacts) {
	const lines = (await readFile(join(artifacts, 'SHA256SUMS'), 'utf8'))
		.trim()
		.split('\n')
	const sums = new Map()
	for (const line of lines) {
		const match = /^([0-9a-f]{64}) {1,2}(.+)$/.exec(line)
		if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`)
		sums.set(match[2], match[1])
	}
	for (const name of await readdir(artifacts))
		if (!unsummed.has(name) && !sums.has(name))
			throw new Error(`Artifact missing from SHA256SUMS: ${name}`)
	for (const [name, expected] of sums) {
		const actual = await sha256File(join(artifacts, name))
		if (actual !== expected)
			throw new Error(`Checksum mismatch for ${name}: ${actual} != ${expected}`)
	}
	return sums.size
}

async function licenseDirs(pkgDir, platform) {
	const dirs = []
	for (const entry of await readdir(pkgDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const dir = join(pkgDir, entry.name)
		if (platform === 'darwin') {
			if (!entry.name.startsWith('mac')) continue
			for (const app of await readdir(dir, { withFileTypes: true }))
				if (app.isDirectory() && app.name.endsWith('.app'))
					dirs.push(join(dir, app.name, 'Contents', 'Resources'))
		} else if (
			entry.name.startsWith(platform === 'linux' ? 'linux' : 'win') &&
			entry.name.includes('unpacked')
		)
			dirs.push(join(dir, 'resources'))
	}
	return dirs
}

export async function verifyPackage(pkgDir, platform) {
	if (!platforms.includes(platform))
		throw new Error(`Unknown platform: ${platform}`)
	const count = await verifyChecksums(join(pkgDir, 'artifacts'))
	const dirs = await licenseDirs(pkgDir, platform)
	if (dirs.length === 0)
		throw new Error(
			`No unpacked resources directory under ${pkgDir} for ${platform}`,
		)
	for (const dir of dirs)
		for (const name of licenseFiles) {
			const file = join(dir, 'licenses', name)
			const info = await stat(file).catch(() => null)
			if (!info?.isFile() || info.size === 0)
				throw new Error(`Missing packaged license: ${file}`)
		}
	return { checksums: count, resources: dirs.length }
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
	const platform = aliases[process.argv[2]] ?? process.argv[2]
	if (!platforms.includes(platform)) {
		console.error(
			`Usage: node tools/package/verify-artifacts.mjs <${[...Object.keys(aliases), ...platforms].join('|')}>`,
		)
		process.exit(2)
	}
	const dist = fileURLToPath(
		new URL('../../apps/desktop/dist/', import.meta.url),
	)
	const roots = (await readdir(dist).catch(() => []))
		.filter((name) => name.startsWith(`${platform}-`))
		.sort()
	if (roots.length === 0) {
		console.error(`No packaged output under ${dist} for ${platform}`)
		process.exit(1)
	}
	for (const name of roots) {
		const result = await verifyPackage(join(dist, name), platform)
		console.log(
			`Verified ${name}: ${result.checksums} checksummed artifacts, licenses in ${result.resources} resources dir(s)`,
		)
	}
}
