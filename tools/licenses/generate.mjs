import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = import.meta.dirname
const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (file) => readFile(file, 'utf8')

async function manifestAt(directory) {
	try {
		const file = await realpath(join(directory, 'package.json'))
		return [dirname(file), JSON.parse(await read(file))]
	} catch (error) {
		if (error.code !== 'ENOENT') throw error
	}
}

async function findManifest(directory, name) {
	for (;;) {
		const found = await manifestAt(join(directory, 'node_modules', name))
		if (found) return found
		const parent = dirname(directory)
		if (parent === directory) return
		directory = parent
	}
}

async function productionPackages() {
	const queue = [await manifestAt(join(root, 'apps/desktop'))]
	const visited = new Set()
	const packages = []
	for (const [directory, pkg] of queue) {
		if (visited.has(directory)) continue
		visited.add(directory)
		if (!pkg.name.startsWith('@novelive/')) packages.push([directory, pkg])
		const optional = pkg.optionalDependencies ?? {}
		for (const name of Object.keys({
			...pkg.dependencies,
			...pkg.peerDependencies,
			...optional,
		})) {
			const found = await findManifest(directory, name)
			if (found) queue.push(found)
			else if (
				!(name in optional) &&
				!pkg.peerDependenciesMeta?.[name]?.optional
			)
				throw new Error(`Missing production dependency ${name} of ${pkg.name}`)
		}
	}
	return packages.sort(([, a], [, b]) =>
		`${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'),
	)
}

export async function generateNotices(output) {
	const parts = [
		'Novelive — THIRD_PARTY_NOTICES',
		'Electron and Chromium: see the original LICENSE.electron.txt (or LICENSE) and LICENSES.chromium.html distributed with Electron.',
		'libvips (LGPL-3.0-or-later), dynamically linked by sharp. Corresponding source: https://github.com/libvips/libvips/releases/tag/v8.18.7. Prebuilt binaries, build scripts and bundled component sources: https://github.com/lovell/sharp-libvips. Linux binary changes: tools/patch-sharp.mjs in the Novelive source repository.',
		await read(join(here, 'LGPL-3.txt')),
		await read(join(here, 'GPL-3.txt')),
		'Upscayl / ncnn Vulkan sidecar: https://github.com/upscayl/upscayl-ncnn/tree/20251207-174704; ncnn: https://github.com/Tencent/ncnn',
		'Real-ESRGAN model weights: https://github.com/xinntao/Real-ESRGAN; 4x-NMKD-YandereNeo: https://openmodeldb.info/models/4x-NMKD-YandereNeo (source, checksums and conversion recorded in bin/upscale/manifest.json).',
	]
	const upscale = join(root, 'bin/upscale/licenses')
	for (const name of (await readdir(upscale)).sort())
		parts.push(name, await read(join(upscale, name)))
	parts.push(
		'U²-NetP matting model: https://github.com/xuebinqin/U-2-Net; ONNX conversion: https://github.com/danielgatis/rembg',
		await read(join(root, 'bin/matting/LICENSE')),
	)
	for (const [directory, pkg] of await productionPackages()) {
		parts.push(
			[
				`${pkg.name}@${pkg.version} — ${pkg.license ?? 'see upstream license'}`,
				pkg.repository?.url ?? pkg.repository ?? pkg.homepage,
			]
				.filter(Boolean)
				.join('\n'),
			...(await readPackageLicenses(directory, pkg.name)),
		)
	}
	await writeFile(
		output,
		`${parts.map((part) => part.trimEnd()).join('\n\n')}\n`,
	)
}

export async function readPackageLicenses(directory, packageName) {
	const names = (await readdir(directory))
		.sort()
		.filter((name) =>
			/^(?:licen[cs]es?|copying|(?:third[-_ ]?party[-_ ]?)?notices?)(?:[._-]|$)/i.test(
				name,
			),
		)
	if (/^@img\/sharp-(?:libvips|win32)-/.test(packageName))
		names.push('README.md')
	const licenses = []
	for (const name of names)
		licenses.push(...(await readLicenses(join(directory, name))))
	return licenses
}

async function readLicenses(path) {
	if (!(await stat(path)).isDirectory()) return [await read(path)]
	const nested = []
	for (const entry of (await readdir(path)).sort())
		nested.push(...(await readLicenses(join(path, entry))))
	return nested
}
