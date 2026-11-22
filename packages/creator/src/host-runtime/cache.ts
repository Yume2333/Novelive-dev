import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const mime = new Map([
	['.webp', 'image/webp'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.svg', 'image/svg+xml'],
])

function within(root: string, target: string) {
	const child = relative(root, target)
	return (
		child &&
		child !== '..' &&
		!child.startsWith(`..${sep}`) &&
		!isAbsolute(child)
	)
}

export async function cacheResponse(root: string, url: string) {
	try {
		const request = new URL(url)
		if (request.hostname !== 'cache') return new Response(null, { status: 404 })
		const name = decodeURIComponent(request.pathname.slice(1))
		if (
			name.includes('\\') ||
			name.includes('\0') ||
			isAbsolute(name) ||
			name.split('/').includes('..')
		)
			return new Response(null, { status: 403 })
		const directory = await realpath(root)
		const candidate = resolve(directory, name)
		const type = mime.get(extname(candidate).toLowerCase())
		if (!type) return new Response(null, { status: 404 })
		const target = await realpath(candidate)
		if (!within(directory, target)) return new Response(null, { status: 403 })
		if (!(await stat(target)).isFile())
			return new Response(null, { status: 404 })
		return new Response(await readFile(target), {
			headers: {
				'content-type': type,
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'",
			},
		})
	} catch {
		return new Response(null, { status: 404 })
	}
}
