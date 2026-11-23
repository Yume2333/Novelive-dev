import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = fileURLToPath(new URL('../../bin/upscale/', import.meta.url))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
function verify(bytes, expected) {
	if (digest(bytes) !== expected) throw new Error('sha256 不匹配')
}

function executable(zip, name) {
	for (let offset = 0; offset + 46 <= zip.length; offset++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) continue
		const length = zip.readUInt16LE(offset + 28)
		if (zip.subarray(offset + 46, offset + 46 + length).toString() !== name)
			continue
		const local = zip.readUInt32LE(offset + 42)
		const start =
			local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
		const bytes = zip.subarray(start, start + zip.readUInt32LE(offset + 20))
		const method = zip.readUInt16LE(offset + 10)
		if (method === 0) return bytes
		if (method === 8) return inflateRawSync(bytes)
		throw new Error(`不支持的 zip 压缩方式: ${method}`)
	}
	throw new Error(`压缩包缺少程序: ${name}`)
}

export async function fetchUpscale(platform = process.platform) {
	const manifest = JSON.parse(
		await readFile(join(root, 'manifest.json'), 'utf8'),
	)
	const entry = manifest.platforms[platform]
	if (!entry) throw new Error(`不支持的平台: ${platform}`)
	for (const model of manifest.models)
		verify(await readFile(join(root, model.path)), model.sha256)
	const target = join(root, platform, entry.executable.split('/').pop())
	try {
		verify(await readFile(target), entry.binarySha256)
		return target
	} catch (error) {
		if (error.code !== 'ENOENT' && error.message !== 'sha256 不匹配')
			throw error
	}
	const response = await fetch(entry.url)
	if (!response.ok) throw new Error(`下载失败: ${response.status}`)
	const archive = Buffer.from(await response.arrayBuffer())
	verify(archive, entry.sha256)
	const binary = executable(archive, entry.executable)
	verify(binary, entry.binarySha256)
	await mkdir(dirname(target), { recursive: true })
	const temporary = `${target}.${process.pid}.tmp`
	try {
		await writeFile(temporary, binary)
		await chmod(temporary, 0o755)
		await rename(temporary, target)
	} finally {
		await rm(temporary, { force: true })
	}
	return target
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	console.log(await fetchUpscale(process.argv[2]))
}
