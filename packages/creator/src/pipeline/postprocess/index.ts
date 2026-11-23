import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { Project } from '../../project'

export interface Profile {
	mode: 'off' | 'single' | 'double'
	tier: 'anime' | 'fast' | 'detail'
}
export interface PostprocessOptions extends Profile {
	target: { width: number; height: number }
	fit: 'cover' | 'contain' | 'fill'
}
export interface Runtime {
	binary?: string
	models?: string
	signal?: AbortSignal
	onProgress?: (progress: number) => void
}
const names = {
	anime: 'realesrgan-x4plus-anime',
	fast: 'realesr-animevideov3-x4',
	detail: '4x-NMKD-YandereNeo',
}

export function resolveUpscale(runtime: Runtime = {}) {
	const root = fileURLToPath(
		new URL('../../../../../bin/upscale/', import.meta.url),
	)
	return {
		binary:
			runtime.binary ??
			join(
				root,
				process.platform,
				process.platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin',
			),
		models: runtime.models ?? join(root, 'models'),
	}
}

export function checkVariantProfile(base: Profile, variant: Profile) {
	if (base.mode !== variant.mode || base.tier !== variant.tier) {
		throw new Error('差分后处理档位与基准不一致')
	}
}

export function variantProfile(base: Profile): Profile {
	return { mode: base.mode, tier: base.tier }
}

export async function postprocess(
	image: Buffer,
	options: PostprocessOptions,
	runtime: Runtime = {},
): Promise<Buffer> {
	runtime.signal?.throwIfAborted()
	let output = image
	if (options.mode !== 'off') {
		const paths = resolveUpscale(runtime)
		const directory = await mkdtemp(join(tmpdir(), 'novelive-upscale-'))
		try {
			const original = await sharp(image).metadata()
			const passes = options.mode === 'double' ? 2 : 1
			for (let pass = 0; pass < passes; pass++) {
				const input = join(directory, 'input.png')
				const result = join(directory, 'output.png')
				await writeFile(input, await sharp(output).png().toBuffer())
				await rm(result, { force: true })
				await new Promise<void>((resolve, reject) => {
					const child = spawn(
						paths.binary,
						[
							'-i',
							input,
							'-o',
							result,
							'-m',
							paths.models,
							'-n',
							names[options.tier],
							'-s',
							'4',
							'-j',
							'1:1:1',
						],
						{ signal: runtime.signal },
					)
					let diagnostic = ''
					let pending = ''
					const consume = (chunk: Buffer) => {
						diagnostic = (diagnostic + chunk.toString()).slice(-4096)
						pending += chunk.toString()
						const lines = pending.split(/[\r\n]/)
						pending = lines.pop() ?? ''
						for (const line of lines) {
							const match = /([\d.]+)%/.exec(line)
							if (match)
								runtime.onProgress?.((pass + Number(match[1]) / 100) / passes)
						}
					}
					child.stdout.on('data', consume)
					child.stderr.on('data', consume)
					child.once('error', reject)
					child.once('close', (code) =>
						code === 0
							? resolve()
							: reject(new Error(`upscayl-bin (${code}): ${diagnostic}`)),
					)
				})
				output = await readFile(result)
				const dimensions = await sharp(output).metadata()
				if (
					dimensions.width !== original.width * 4 ||
					dimensions.height !== original.height * 4
				) {
					throw new Error('upscayl-bin 输出不是四倍尺寸')
				}
				if (pass + 1 < passes)
					output = await sharp(output)
						.resize(original.width, original.height, {
							kernel: 'lanczos3',
							fit: 'fill',
						})
						.png()
						.toBuffer()
			}
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}
	runtime.signal?.throwIfAborted()
	const result = await sharp(output)
		.resize({ ...options.target, fit: options.fit, kernel: 'lanczos3' })
		.png()
		.toBuffer()
	runtime.onProgress?.(1)
	return result
}

interface AssetState {
	profile?: Profile
	error?: string
}
export const profileStatePath = 'candidates/postprocess.json'
export async function readProfiles(
	project: Pick<Project, 'readFile'>,
): Promise<Record<string, AssetState>> {
	try {
		return JSON.parse((await project.readFile(profileStatePath)).toString())
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
		throw error
	}
}

export async function recordProfile(
	project: Pick<Project, 'readFile' | 'writeFile'>,
	path: string,
	profile: Profile,
) {
	const state = await readProfiles(project)
	state[path] = { profile: variantProfile(profile) }
	await project.writeFile(profileStatePath, Buffer.from(JSON.stringify(state)))
}

export interface BackfillAsset {
	path: string
	basePath?: string
	options: PostprocessOptions
}
export async function backfill(
	project: Pick<Project, 'readFile' | 'writeFile'>,
	assets: BackfillAsset[],
	runtime: Runtime & { lossless?: boolean } = {},
) {
	const state = await readProfiles(project)
	const results: {
		path: string
		status: 'processed' | 'skipped' | 'failed'
		error?: string
	}[] = []
	for (const asset of assets) {
		runtime.signal?.throwIfAborted()
		if (state[asset.path]?.profile) {
			results.push({ path: asset.path, status: 'skipped' })
			continue
		}
		try {
			const base = asset.basePath ? state[asset.basePath]?.profile : undefined
			if (asset.basePath && !base) throw new Error('基准图尚未记录后处理档位')
			const options = {
				...asset.options,
				...(base ? variantProfile(base) : {}),
			}
			const png = await postprocess(
				await project.readFile(asset.path),
				options,
				runtime,
			)
			const webp = await sharp(png)
				.webp({ quality: 90, lossless: runtime.lossless })
				.toBuffer()
			runtime.signal?.throwIfAborted()
			await project.writeFile(asset.path, webp)
			state[asset.path] = { profile: variantProfile(options) }
			results.push({ path: asset.path, status: 'processed' })
		} catch (error) {
			runtime.signal?.throwIfAborted()
			const message = error instanceof Error ? error.message : String(error)
			state[asset.path] = { error: message }
			results.push({ path: asset.path, status: 'failed', error: message })
		}
		await project.writeFile(
			profileStatePath,
			Buffer.from(JSON.stringify(state)),
		)
	}
	return results
}
