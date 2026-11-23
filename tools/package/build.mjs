import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateNotices } from '../licenses/generate.mjs'
import { fetchUpscale } from '../upscale/fetch.mjs'

const platform = process.argv[2]
const arch = process.arch
if (
	platform !== process.platform ||
	(arch !== 'x64' && !(platform === 'darwin' && arch === 'arm64'))
)
	throw new Error(
		`Unsupported native packaging host: ${process.platform}/${arch} for ${platform}`,
	)

const desktop = fileURLToPath(new URL('../../apps/desktop/', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const { version } = require('./package.json')
const { build } = require('electron-builder')
const bin = join(
	dirname(require.resolve('electron-vite/package.json')),
	'bin/electron-vite.js',
)

await fetchUpscale(platform)
execFileSync(process.execPath, [bin, 'build'], {
	cwd: desktop,
	stdio: 'inherit',
})
const licenseDir = join(desktop, 'out/licenses')
await mkdir(licenseDir, { recursive: true })
await generateNotices(join(licenseDir, 'THIRD_PARTY_NOTICES.txt'))

const dist = join(desktop, 'dist')
await mkdir(dist, { recursive: true })
const output = await mkdtemp(join(dist, `${platform}-${arch}-`))
await build({
	projectDir: desktop,
	publish: 'never',
	config: { directories: { output } },
})
const artifacts = (await readdir(output)).filter((name) =>
	/\.(?:appimage|exe|zip|dmg|blockmap)$|^latest(?:-mac|-linux)?\.yml$/i.test(
		name,
	),
)
const expected = {
	linux: ['.AppImage', 'latest-linux.yml'],
	win32: ['.exe', 'latest.yml'],
	darwin: ['.dmg', '.zip', 'latest-mac.yml'],
}[platform]
for (const suffix of expected)
	if (!artifacts.some((name) => name.endsWith(suffix)))
		throw new Error(`Missing packaging output: ${suffix}`)
const delivery = join(output, 'artifacts')
await mkdir(delivery)
const checksums = []
for (const name of artifacts.sort()) {
	const file = join(output, name)
	const hash = createHash('sha256')
	for await (const bytes of createReadStream(file)) hash.update(bytes)
	checksums.push(`${hash.digest('hex')}  ${name}`)
	await copyFile(file, join(delivery, name))
}
await writeFile(join(delivery, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
await writeFile(
	join(delivery, 'BUILD.txt'),
	`Novelive ${version}\nTarget: ${platform}/${arch}\nHost: ${process.platform}/${process.arch}\n`,
)
console.log(`Novelive ${version} ${platform}/${arch} artifacts: ${delivery}`)
