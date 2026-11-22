import { execFileSync } from 'node:child_process'
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'

function run(tool, ...args) {
	return execFileSync(tool, args, { encoding: 'utf8' }).trim()
}

function patchSharp() {
	const desktop = createRequire(
		new URL('../apps/desktop/package.json', import.meta.url),
	)
	const sharp = createRequire(desktop.resolve('sharp'))
	const libc = process.report.getReport().header.glibcVersionRuntime
		? 'linux'
		: 'linuxmusl'
	const platform = `${libc}-${process.arch}`
	const addonDir = join(
		dirname(sharp.resolve(`@img/sharp-${platform}/package`)),
		'lib',
	)
	const binaries = readdirSync(addonDir).filter((name) =>
		name.endsWith('.node'),
	)
	if (binaries.length !== 1) throw new Error('Expected one native sharp addon')
	const addon = join(addonDir, binaries[0])
	const source = sharp.resolve(`@img/sharp-libvips-${platform}/binary`)
	const library = run('patchelf', '--print-needed', addon)
		.split('\n')
		.find((name) => name.startsWith('libvips-cpp.so.'))
	if (!library)
		throw new Error('sharp addon does not link to a libvips-cpp shared library')
	const dir = dirname(addon)
	const colocated = join(dir, library)
	if (
		existsSync(colocated) &&
		run('patchelf', '--print-rpath', addon) === '$ORIGIN'
	)
		return

	const stage = mkdtempSync(join(dir, '.novelive-sharp-'))
	try {
		const patchedLib = join(stage, library)
		const patchedAddon = join(stage, basename(addon))
		const symbols = run('nm', '-D', '--defined-only', '--format=posix', source)
			.split('\n')
			.map((line) => line.split(' ')[0])
			.filter((name) => /^(?:g_|glib_|nsgif_|lzw_)/.test(name))
		if (symbols.length === 0)
			throw new Error('No private libvips symbols found to isolate')
		const map = join(stage, 'symbols.txt')
		writeFileSync(
			map,
			symbols.map((name) => `${name} novelive_vips_${name}\n`).join(''),
		)
		run('objcopy', source, patchedLib)
		run('objcopy', addon, patchedAddon)
		run('patchelf', '--rename-dynamic-symbols', map, patchedLib)
		run('patchelf', '--rename-dynamic-symbols', map, patchedAddon)
		run('patchelf', '--force-rpath', '--set-rpath', '$ORIGIN', patchedAddon)
		renameSync(patchedLib, colocated)
		renameSync(patchedAddon, addon)
	} finally {
		rmSync(stage, { recursive: true, force: true })
	}
	console.log(`Patched sharp for Electron (${platform})`)
}

if (process.platform === 'linux') patchSharp()
